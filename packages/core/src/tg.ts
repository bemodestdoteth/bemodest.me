import { Bot } from "grammy";

function formatDateTime(date: Date, timeZone: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const RESERVED_WORDS = [
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
];

export function parseMarkdownV2(
  msg: string,
  exclude?: string | string[] | null
): string {
  const reserved = [...RESERVED_WORDS];
  if (exclude) {
    const excludeList = typeof exclude === "string" ? [exclude] : exclude;
    for (const excludeWord of excludeList) {
      if (!reserved.includes(excludeWord)) {
        throw new Error(
          `Invalid exclude word: ${excludeWord}. Please use one of the following: ${reserved}`
        );
      }
      const idx = reserved.indexOf(excludeWord);
      if (idx !== -1) {
        reserved.splice(idx, 1);
      }
    }
  }
  let result = String(msg);
  for (const word of reserved) {
    result = result.split(word).join(`\\${word}`);
  }
  return result;
}

export class Tg {
  private tgBot: Bot;
  private chatId: string | number;
  private topicId?: number;

  constructor(token: string, chatId: string | number, topicId?: string | number | null) {
    this.tgBot = new Bot(token);
    this.chatId = chatId;
    this.topicId = topicId ? Number(topicId) : undefined;
  }

  private _chunkMessages(msg: string): string[] {
    if (!msg) {
      return [];
    }

    const MAX_LEN = 4096;

    let numChunks = Math.max(1, Math.ceil(msg.length / MAX_LEN));

    while (true) {
      const numberingOverhead = `\n [${numChunks}/${numChunks}]`.length;
      const contentSize = MAX_LEN - numberingOverhead;
      const newNumChunks = Math.max(1, Math.ceil(msg.length / contentSize));

      if (newNumChunks === numChunks) {
        break;
      }
      numChunks = newNumChunks;
    }

    const numberingOverhead = `\n [${numChunks}/${numChunks}]`.length;
    const contentSize = MAX_LEN - numberingOverhead;

    const chunkedMessage: string[] = [];
    for (let i = 0; i < numChunks; i++) {
      const start = i * contentSize;
      const end = start + contentSize;
      const chunkContent = msg.slice(start, end);
      const chunkWithHeader = `${chunkContent}\n [${i + 1}/${numChunks}]`;
      chunkedMessage.push(chunkWithHeader);
    }

    return chunkedMessage;
  }

  async sendMessage(resMsg: string): Promise<void> {
    await this.tgBot.api.sendMessage(this.chatId, resMsg, {
      message_thread_id: this.topicId,
      parse_mode: "MarkdownV2",
    });
  }

  async sendNotification(
    resType: string,
    resFrom: string,
    resMsg: string,
    formatting = true,
    autoWrap = true,
    exclude?: string | string[] | null,
    tz?: string | null
  ): Promise<void> {
    const timezone = tz ?? "Asia/Seoul";
    if (!formatting && exclude) {
      throw new Error("Cannot exclude words without formatting");
    }

    const headerMsg = `__*${parseMarkdownV2(resType)} notification from ${parseMarkdownV2(resFrom)}*__\n`;
    const now = formatDateTime(new Date(), timezone);
    const tailerMsg = `\n\n🕑${now}`;

    const tgMsg = formatting
      ? `${headerMsg}${parseMarkdownV2(resMsg, exclude)}${tailerMsg}`
      : `${headerMsg}${resMsg}${tailerMsg}`;

    if (autoWrap && tgMsg.length > 4096) {
      for (const chunk of this._chunkMessages(tgMsg)) {
        await this.tgBot.api.sendMessage(this.chatId, chunk, {
          message_thread_id: this.topicId,
          parse_mode: "MarkdownV2",
        });
      }
    } else {
      await this.tgBot.api.sendMessage(this.chatId, tgMsg, {
        message_thread_id: this.topicId,
        parse_mode: "MarkdownV2",
      });
    }
  }

  async sendTradeNotification(
    resFrom: string,
    resFunc: string,
    resCoin: string,
    resMsg: Record<string, string>
  ): Promise<void> {
    let tgMsg = `__*💸Result of ${parseMarkdownV2(resCoin)} ${parseMarkdownV2(resFunc)} on ${parseMarkdownV2(resFrom)}*__\n`;
    for (const [key, item] of Object.entries(resMsg)) {
      tgMsg = tgMsg + `*${parseMarkdownV2(key.charAt(0).toUpperCase() + key.slice(1))}:* ${parseMarkdownV2(item)}\n`;
    }

    await this.tgBot.api.sendMessage(this.chatId, tgMsg, {
      message_thread_id: this.topicId,
      parse_mode: "MarkdownV2",
    });
  }

  async sendErrorNotification(
    resFrom: string,
    resMsg: string,
    tz?: string | null
  ): Promise<void> {
    const timezone = tz ?? "Asia/Seoul";
    const headerMsg = `__*🚫Error occurred from ${parseMarkdownV2(resFrom)}\\!*__\n`;
    const now = formatDateTime(new Date(), timezone);
    const tailerMsg = `\n\n🕑${now}`;

    const tgMsg = `${headerMsg}${parseMarkdownV2(resMsg)}${tailerMsg}`;
    await this.tgBot.api.sendMessage(this.chatId, tgMsg, {
      message_thread_id: this.topicId,
      parse_mode: "MarkdownV2",
    });
  }
}
