import { logger } from "./logger.js";
import { NetworkAnnotation } from "./models.js";

export class NetworkManager {
  private static _instance: NetworkManager | null = null;
  private static _initPromise: Promise<void> | null = null;

  private _networks: NetworkAnnotation[] = [];
  private _codeToCaip2Dict: Map<string, string> = new Map();
  private _caip2ToCodeDict: Map<string, string> = new Map();
  private _caip2ToExchangeMappings: Map<string, Map<string, string | Record<string, string>>> = new Map();
  private _exchangeToCaip2Mappings: Map<string, Map<string, string>> = new Map();
  private _initialized = false;

  static getInstance(): NetworkManager {
    if (NetworkManager._instance === null) {
      NetworkManager._instance = new NetworkManager();
    }
    return NetworkManager._instance;
  }

  constructor() {}

  async init(networks?: NetworkAnnotation[]): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (NetworkManager._initPromise) {
      await NetworkManager._initPromise;
      return;
    }

    NetworkManager._initPromise = this._doInit(networks);

    try {
      await NetworkManager._initPromise;
    } finally {
      NetworkManager._initPromise = null;
    }
  }

  private async _doInit(networks?: NetworkAnnotation[]): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (!networks) {
      try {
        const { MongoDBClient } = await import("./db.js");
        const publicClient = new MongoDBClient();
        await publicClient.connect();
        const networkData = await publicClient.readDocument("chains", {});
        this._networks = networkData.map((n: any) => ({
          annotation: n.annotation,
          caip2: n.caip2,
        })) as NetworkAnnotation[];
      } catch (e) {
        logger.error(`Failed to fetch network metadata from database: ${e}`);
        return;
      }
    } else {
      this._networks = networks;
    }

    this._codeToCaip2Dict.clear();
    this._caip2ToCodeDict.clear();
    this._caip2ToExchangeMappings.clear();
    this._exchangeToCaip2Mappings.clear();

    for (const network of this._networks) {
      const caip2 = network.caip2;
      const code = network.annotation.code as string | undefined;

      if (code) {
        this._codeToCaip2Dict.set(code, caip2);
        this._caip2ToCodeDict.set(caip2, code);
      }

      for (const [exchange, mappedVal] of Object.entries(network.annotation)) {
        if (exchange === "code") continue;

        if (!this._caip2ToExchangeMappings.has(exchange)) {
          this._caip2ToExchangeMappings.set(exchange, new Map());
        }
        if (!this._exchangeToCaip2Mappings.has(exchange)) {
          this._exchangeToCaip2Mappings.set(exchange, new Map());
        }

        this._caip2ToExchangeMappings.get(exchange)!.set(caip2, mappedVal as string | Record<string, string>);

        if (typeof mappedVal === "object" && mappedVal !== null) {
          for (const coinVal of Object.values(mappedVal)) {
            this._exchangeToCaip2Mappings.get(exchange)!.set(coinVal as string, caip2);
          }
        } else if (typeof mappedVal === "string") {
          this._exchangeToCaip2Mappings.get(exchange)!.set(mappedVal, caip2);
        }
      }
    }

    this._initialized = true;
  }

  codeToCaip2(code: string): string {
    if (!this._codeToCaip2Dict.has(code)) {
      logger.warn(`Network code ${code} is missing from mappings. Returning as is.`);
    }
    return this._codeToCaip2Dict.get(code) ?? code;
  }

  caip2ToCode(caip2: string): string {
    if (!this._caip2ToCodeDict.has(caip2)) {
      logger.warn(`CAIP-2 ${caip2} is missing from mappings. Returning as is.`);
    }
    return this._caip2ToCodeDict.get(caip2) ?? caip2;
  }

  caip2ToExchange(caip2: string, exchange: string, coin?: string | null): string {
    exchange = exchange.toLowerCase();
    const mappings = this._caip2ToExchangeMappings.get(exchange);

    if (!mappings || !mappings.has(caip2)) {
      logger.warn(`[${exchange}] ${caip2} is missing from CAIP-2 to exchange dictionary. Returning as is.`);
      return caip2;
    }

    const val = mappings.get(caip2)!;
    if (coin && typeof val === "object" && coin in val) {
      return val[coin];
    } else if (typeof val === "object") {
      return (val as Record<string, string>)[caip2] ?? caip2;
    }
    return val as string;
  }

  exchangeToCaip2(network: string, exchange: string): string {
    exchange = exchange.toLowerCase();
    const mappings = this._exchangeToCaip2Mappings.get(exchange);

    if (!mappings || !mappings.has(network)) {
      logger.warn(`[${exchange}] ${network} is missing from exchange to CAIP-2 dictionary. Returning as is.`);
    }
    return mappings?.get(network) ?? network;
  }

  updateExchangeMappings(
    exchange: string,
    caip2ToExchange: Record<string, string | Record<string, string>>,
    exchangeToCaip2: Record<string, string>
  ): void {
    exchange = exchange.toLowerCase();
    if (!this._caip2ToExchangeMappings.has(exchange)) {
      this._caip2ToExchangeMappings.set(exchange, new Map());
    }
    if (!this._exchangeToCaip2Mappings.has(exchange)) {
      this._exchangeToCaip2Mappings.set(exchange, new Map());
    }

    for (const [k, v] of Object.entries(caip2ToExchange)) {
      this._caip2ToExchangeMappings.get(exchange)!.set(k, v);
    }
    for (const [k, v] of Object.entries(exchangeToCaip2)) {
      this._exchangeToCaip2Mappings.get(exchange)!.set(k, v);
    }
  }
}

export const networkManager = NetworkManager.getInstance();
