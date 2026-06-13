import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

function loadEnv() {
  const output = { ...process.env };
  if (!fs.existsSync(".env")) {
    return output;
  }

  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (key && output[key] === undefined) {
      output[key] = value;
    }
  }
  return output;
}

function parseDatabaseUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, ""))
  };
}

export class PostgresClient {
  constructor(connection) {
    this.connection = connection;
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
    this.backendKey = undefined;
    this.scram = undefined;
  }

  async connect() {
    this.socket = net.createConnection({
      host: this.connection.host,
      port: this.connection.port
    });
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    });
    await once(this.socket, "connect");
    this.socket.write(startupMessage(this.connection.user, this.connection.database));

    while (true) {
      const message = await this.readMessage();
      if (message.type === "R") {
        await this.handleAuthentication(message.payload);
      } else if (message.type === "K") {
        this.backendKey = message.payload;
      } else if (message.type === "S") {
        continue;
      } else if (message.type === "Z") {
        return;
      } else if (message.type === "E") {
        throw new Error(parseError(message.payload));
      }
    }
  }

  async handleAuthentication(payload) {
    const authType = payload.readInt32BE(0);
    if (authType === 0) {
      return;
    }
    if (authType === 3) {
      this.socket.write(passwordMessage(this.connection.password));
      return;
    }
    if (authType === 5) {
      const salt = payload.subarray(4, 8);
      this.socket.write(passwordMessage(md5Password(this.connection.user, this.connection.password, salt)));
      return;
    }
    if (authType === 10) {
      const mechanisms = readSaslMechanisms(payload.subarray(4));
      if (!mechanisms.includes("SCRAM-SHA-256")) {
        throw new Error(`Unsupported PostgreSQL SASL mechanisms: ${mechanisms.join(", ")}`);
      }
      const nonce = crypto.randomBytes(18).toString("base64");
      const gs2Header = "n,,";
      const clientFirstBare = `n=${scramEscape(this.connection.user)},r=${nonce}`;
      this.scram = {
        nonce,
        gs2Header,
        clientFirstBare,
        serverSignature: undefined
      };
      this.socket.write(saslInitialResponseMessage("SCRAM-SHA-256", gs2Header + clientFirstBare));
      return;
    }
    if (authType === 11) {
      if (!this.scram) {
        throw new Error("Received SCRAM continuation without SCRAM state");
      }
      const serverFirst = payload.subarray(4).toString("utf8");
      const parts = parseScramAttributes(serverFirst);
      const serverNonce = parts.r;
      const salt = Buffer.from(parts.s, "base64");
      const iterations = Number(parts.i);
      if (!serverNonce?.startsWith(this.scram.nonce) || !salt.length || !Number.isFinite(iterations)) {
        throw new Error("Invalid SCRAM server challenge");
      }
      const clientFinalWithoutProof = `c=${Buffer.from(this.scram.gs2Header).toString("base64")},r=${serverNonce}`;
      const saltedPassword = crypto.pbkdf2Sync(this.connection.password, salt, iterations, 32, "sha256");
      const clientKey = hmac(saltedPassword, "Client Key");
      const storedKey = crypto.createHash("sha256").update(clientKey).digest();
      const authMessage = `${this.scram.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
      const clientSignature = hmac(storedKey, authMessage);
      const clientProof = xorBuffers(clientKey, clientSignature).toString("base64");
      const serverKey = hmac(saltedPassword, "Server Key");
      this.scram.serverSignature = hmac(serverKey, authMessage).toString("base64");
      this.socket.write(saslResponseMessage(`${clientFinalWithoutProof},p=${clientProof}`));
      return;
    }
    if (authType === 12) {
      const serverFinal = payload.subarray(4).toString("utf8");
      const parts = parseScramAttributes(serverFinal);
      if (this.scram?.serverSignature && parts.v && parts.v !== this.scram.serverSignature) {
        throw new Error("Invalid SCRAM server signature");
      }
      return;
    }
    throw new Error(`Unsupported PostgreSQL authentication method ${authType}`);
  }

  async query(sql) {
    this.socket.write(queryMessage(sql));
    const statements = [];
    let currentFields = [];
    let currentRows = [];
    let commandTag = "";

    while (true) {
      const message = await this.readMessage();
      if (message.type === "T") {
        currentFields = parseRowDescription(message.payload);
        currentRows = [];
      } else if (message.type === "D") {
        currentRows.push(parseDataRow(message.payload, currentFields));
      } else if (message.type === "C") {
        commandTag = readCString(message.payload, 0).value;
        if (currentFields.length || currentRows.length) {
          statements.push({ command: commandTag, rows: currentRows });
        } else {
          statements.push({ command: commandTag, rows: [] });
        }
        currentFields = [];
        currentRows = [];
      } else if (message.type === "E") {
        throw new Error(parseError(message.payload));
      } else if (message.type === "N") {
        continue;
      } else if (message.type === "Z") {
        return statements;
      }
    }
  }

  async end() {
    if (!this.socket || this.socket.destroyed) {
      return;
    }
    this.socket.write(terminateMessage());
    this.socket.end();
  }

  async readMessage() {
    while (this.buffer.length < 5) {
      await once(this.socket, "data");
    }
    const type = String.fromCharCode(this.buffer[0]);
    const length = this.buffer.readInt32BE(1);
    while (this.buffer.length < 1 + length) {
      await once(this.socket, "data");
    }
    const payload = this.buffer.subarray(5, 1 + length);
    this.buffer = this.buffer.subarray(1 + length);
    return { type, payload };
  }
}

function startupMessage(user, database) {
  const pairs = [
    ["user", user],
    ["database", database],
    ["client_encoding", "UTF8"]
  ];
  const body = Buffer.concat([
    int32(196608),
    ...pairs.flatMap(([key, value]) => [cstring(key), cstring(value)]),
    Buffer.from([0])
  ]);
  return Buffer.concat([int32(body.length + 4), body]);
}

function passwordMessage(password) {
  const body = cstring(password);
  return Buffer.concat([Buffer.from("p"), int32(body.length + 4), body]);
}

function saslInitialResponseMessage(mechanism, initialResponse) {
  const response = Buffer.from(initialResponse, "utf8");
  const body = Buffer.concat([
    cstring(mechanism),
    int32(response.length),
    response
  ]);
  return Buffer.concat([Buffer.from("p"), int32(body.length + 4), body]);
}

function saslResponseMessage(responseText) {
  const body = Buffer.from(responseText, "utf8");
  return Buffer.concat([Buffer.from("p"), int32(body.length + 4), body]);
}

function queryMessage(sql) {
  const body = cstring(sql);
  return Buffer.concat([Buffer.from("Q"), int32(body.length + 4), body]);
}

function terminateMessage() {
  return Buffer.concat([Buffer.from("X"), int32(4)]);
}

function md5Password(user, password, salt) {
  const inner = crypto.createHash("md5").update(password + user).digest("hex");
  return "md5" + crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
}

function readSaslMechanisms(payload) {
  const mechanisms = [];
  let offset = 0;
  while (offset < payload.length && payload[offset] !== 0) {
    const item = readCString(payload, offset);
    mechanisms.push(item.value);
    offset = item.nextOffset;
  }
  return mechanisms;
}

function parseScramAttributes(value) {
  const output = {};
  for (const part of value.split(",")) {
    const index = part.indexOf("=");
    if (index > 0) {
      output[part.slice(0, index)] = part.slice(index + 1);
    }
  }
  return output;
}

function scramEscape(value) {
  return value.replace(/=/g, "=3D").replace(/,/g, "=2C");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function xorBuffers(left, right) {
  const output = Buffer.alloc(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] ^ right[index];
  }
  return output;
}

function parseRowDescription(payload) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const fields = [];
  for (let index = 0; index < count; index += 1) {
    const name = readCString(payload, offset);
    offset = name.nextOffset + 18;
    fields.push(name.value);
  }
  return fields;
}

function parseDataRow(payload, fields) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const row = {};
  for (let index = 0; index < count; index += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    if (length === -1) {
      row[fields[index]] = null;
    } else {
      row[fields[index]] = payload.subarray(offset, offset + length).toString("utf8");
      offset += length;
    }
  }
  return row;
}

function parseError(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length && payload[offset] !== 0) {
    const type = String.fromCharCode(payload[offset]);
    const value = readCString(payload, offset + 1);
    fields[type] = value.value;
    offset = value.nextOffset;
  }
  return fields.M || "PostgreSQL error";
}

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  return {
    value: buffer.subarray(offset, end).toString("utf8"),
    nextOffset: end + 1
  };
}

function cstring(value) {
  return Buffer.from(`${value}\0`, "utf8");
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

async function once(emitter, event) {
  return await new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      emitter.off(event, onEvent);
      emitter.off("error", onError);
    };
    emitter.once(event, onEvent);
    emitter.once("error", onError);
  });
}

async function main() {
  const command = process.argv[2];
  const sqlArg = process.argv[3];

  if (!command) {
    console.error("Usage: postgres_tool.mjs <query|file> <sql-or-file>");
    process.exit(1);
  }

  const env = loadEnv();
  const databaseUrl = env.USE_DATABASE_PUBLIC_URL === "true" && env.DATABASE_PUBLIC_URL
    ? env.DATABASE_PUBLIC_URL
    : env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not configured");
    process.exit(1);
  }

  const connection = parseDatabaseUrl(databaseUrl);
  const client = new PostgresClient(connection);

  try {
    await client.connect();
    const sql = command === "file" ? fs.readFileSync(path.resolve(sqlArg), "utf8") : sqlArg;
    const result = await client.query(sql);
    await client.end();
    process.stdout.write(JSON.stringify(result, null, 2));
  } catch (error) {
    try {
      await client.end();
    } catch {
      // Ignore shutdown errors.
    }
    console.error(JSON.stringify({
      error: error?.message || String(error),
      code: error?.code,
      name: error?.name
    }, null, 2));
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
