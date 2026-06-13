import net from "node:net";
import tls from "node:tls";

export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
};

export type SmtpConfig = {
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
};

type Socket = net.Socket | tls.TLSSocket;

export async function sendSmtpEmail(config: SmtpConfig, message: EmailMessage): Promise<void> {
  if (!config.host) {
    throw new Error("SMTP_HOST is required to send dashboard email");
  }
  if (!message.from) {
    throw new Error("DAILY_DASHBOARD_FROM or SMTP_FROM is required to send dashboard email");
  }
  if (!message.to.length) {
    throw new Error("At least one dashboard email recipient is required");
  }

  const client = await SmtpClient.connect(config);
  try {
    await client.expect(220);
    await client.command(`EHLO ${hostname()}`, 250);

    if (!config.secure && config.port !== 25) {
      await client.command("STARTTLS", 220);
      await client.startTls(config.host);
      await client.command(`EHLO ${hostname()}`, 250);
    }

    if (config.user && config.password) {
      await client.command("AUTH LOGIN", 334);
      await client.command(Buffer.from(config.user).toString("base64"), 334);
      await client.command(Buffer.from(config.password).toString("base64"), 235);
    }

    await client.command(`MAIL FROM:<${message.from}>`, 250);
    for (const recipient of message.to) {
      await client.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }

    await client.command("DATA", 354);
    await client.writeData(formatMessage(message));
    await client.expect(250);
    await client.command("QUIT", 221);
  } finally {
    client.close();
  }
}

class SmtpClient {
  private buffer = "";
  private socket: Socket;
  private waiters: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.rejectAll(error));
    socket.on("close", () => this.rejectAll(new Error("SMTP connection closed")));
  }

  static connect(config: Required<Pick<SmtpConfig, "port" | "secure">> & Pick<SmtpConfig, "host">): Promise<SmtpClient> {
    if (!config.host) {
      throw new Error("SMTP host is required");
    }

    return new Promise((resolve, reject) => {
      const socket = config.secure
        ? tls.connect(config.port, config.host, { servername: config.host })
        : net.connect(config.port, config.host);

      socket.once("connect", () => resolve(new SmtpClient(socket)));
      socket.once("error", reject);
    });
  }

  async startTls(host: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const upgraded = tls.connect({
        socket: this.socket as net.Socket,
        servername: host
      }, () => resolve());
      upgraded.once("error", reject);
      upgraded.setEncoding("utf8");
      upgraded.on("data", (chunk) => this.receive(chunk));
      upgraded.on("error", (error) => this.rejectAll(error));
      upgraded.on("close", () => this.rejectAll(new Error("SMTP connection closed")));
      this.socket = upgraded;
    });
  }

  async command(command: string, expected: number | number[]): Promise<string> {
    this.socket.write(`${command}\r\n`);
    return this.expect(expected);
  }

  async writeData(data: string): Promise<void> {
    this.socket.write(`${dotEscape(data)}\r\n.\r\n`);
  }

  async expect(expected: number | number[]): Promise<string> {
    const expectedCodes = Array.isArray(expected) ? expected : [expected];
    const line = await this.nextResponse();
    const code = Number(line.slice(0, 3));
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP command failed: ${line}`);
    }

    return line;
  }

  close() {
    this.socket.end();
  }

  private nextResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drain();
    });
  }

  private receive(chunk: string | Buffer) {
    this.buffer += String(chunk);
    this.drain();
  }

  private drain() {
    while (this.waiters.length) {
      const parsed = readSmtpResponse(this.buffer);
      if (!parsed) {
        return;
      }

      this.buffer = parsed.remaining;
      const waiter = this.waiters.shift();
      waiter?.resolve(parsed.response);
    }
  }

  private rejectAll(error: Error) {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }
}

function readSmtpResponse(buffer: string): { response: string; remaining: string } | undefined {
  const lines: string[] = [];
  let consumed = 0;

  while (consumed < buffer.length) {
    const newlineIndex = buffer.indexOf("\n", consumed);
    if (newlineIndex === -1) {
      return undefined;
    }

    const line = buffer.slice(consumed, newlineIndex).replace(/\r$/, "");
    lines.push(line);
    consumed = newlineIndex + 1;

    if (/^\d{3} /.test(line)) {
      return {
        response: lines.join("\n"),
        remaining: buffer.slice(consumed)
      };
    }
  }

  return undefined;
}

function formatMessage(message: EmailMessage): string {
  const boundary = `ddp-dashboard-${Date.now()}`;
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];

  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.html ?? textToHtml(message.text),
    "",
    `--${boundary}--`
  ].join("\r\n");
}

function encodeHeader(value: string): string {
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function textToHtml(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`;
}

function dotEscape(value: string): string {
  return value.replace(/^\./gm, "..");
}

function hostname(): string {
  return "doo-doo-patrol.local";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
