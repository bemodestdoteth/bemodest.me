export * from './generated.js';
import { z } from 'zod';
export declare const CAIP2_RE: RegExp;
/**
 * Note: using '/' internally for Redis-safe encoding (eip155/1)
 * The DB stores with ':' (eip155:1). Validate DB values with:
 */
export declare const CAIP2_DB_RE: RegExp;
export declare const DW_STATUS_VALUES: readonly ["both", "deposit_only", "withdraw_only", "suspended"];
export declare const ALERT_CONDITIONS: readonly ["spread_pct", "price_above", "price_below", "change_pct_5m", "volume_spike"];
export declare const Caip2Schema: z.ZodString;
export declare const Caip2RedisSchema: z.ZodString;
export declare const AliasSchema: z.ZodObject<{
    name: z.ZodString;
    chain: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    chain: string;
}, {
    name: string;
    chain: string;
}>;
export declare const LabelSchema: z.ZodObject<{
    addr: z.ZodString;
    label: z.ZodString;
    chain: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    entity: z.ZodOptional<z.ZodString>;
    entityImage: z.ZodOptional<z.ZodString>;
    tracking: z.ZodDefault<z.ZodBoolean>;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    label: string;
    chain: string;
    addr: string;
    tracking: boolean;
    code?: string | undefined;
    entity?: string | undefined;
    entityImage?: string | undefined;
    comment?: string | undefined;
}, {
    label: string;
    chain: string;
    addr: string;
    code?: string | undefined;
    entity?: string | undefined;
    entityImage?: string | undefined;
    tracking?: boolean | undefined;
    comment?: string | undefined;
}>;
export type Label = z.infer<typeof LabelSchema>;
export declare const EntitySchema: z.ZodObject<{
    name: z.ZodString;
    code: z.ZodString;
    tracking: z.ZodDefault<z.ZodBoolean>;
    image: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    code: string;
    tracking: boolean;
    comment?: string | undefined;
    image?: string | undefined;
}, {
    name: string;
    code: string;
    tracking?: boolean | undefined;
    comment?: string | undefined;
    image?: string | undefined;
}>;
export type Entity = z.infer<typeof EntitySchema>;
export declare const AuthSessionSchema: z.ZodObject<{
    userId: z.ZodString;
    type: z.ZodOptional<z.ZodEnum<["web", "extension"]>>;
    iat: z.ZodOptional<z.ZodNumber>;
    exp: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    type?: "web" | "extension" | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}, {
    userId: string;
    type?: "web" | "extension" | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export declare const LoginRequestSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
}, {
    username: string;
    password: string;
}>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export declare const ApiResponseSchema: <T extends z.ZodType>(dataSchema: T) => z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, z.objectUtil.addQuestionMarks<z.baseObjectOutputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}>, any> extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never, z.baseObjectInputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}> extends infer T_2 ? { [k_1 in keyof T_2]: T_2[k_1]; } : never>;
export type ApiResponse<T> = {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
    meta?: {
        executionTimeMs?: number;
        itemsProcessed?: number;
    };
};
export declare const ErrorObjectSchema: z.ZodObject<{
    message: z.ZodString;
    code: z.ZodString;
    statusCode: z.ZodNumber;
    timestamp: z.ZodString;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    requestId?: string | undefined;
}, {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    requestId?: string | undefined;
}>;
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;
export declare const ChainGetSchema: z.ZodObject<{
    params: z.ZodDefault<z.ZodOptional<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
}, "strip", z.ZodTypeAny, {
    params: {};
}, {
    params?: {} | undefined;
}>;
export declare const EntityGetSchema: z.ZodObject<{
    params: z.ZodDefault<z.ZodOptional<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
}, "strip", z.ZodTypeAny, {
    params: {};
}, {
    params?: {} | undefined;
}>;
export declare const EntityInsertSchema: z.ZodObject<{
    body: z.ZodRecord<z.ZodString, z.ZodObject<{
        image: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        imageFilename: z.ZodOptional<z.ZodString>;
        comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tracking: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        tracking: boolean;
        comment: string;
        image: string;
        imageFilename?: string | undefined;
    }, {
        tracking?: boolean | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    body: Record<string, {
        tracking: boolean;
        comment: string;
        image: string;
        imageFilename?: string | undefined;
    }>;
}, {
    body: Record<string, {
        tracking?: boolean | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
    }>;
}>;
export declare const EntityDeleteSchema: z.ZodObject<{
    body: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        name: string;
    };
}, {
    body: {
        name: string;
    };
}>;
export declare const EntityUpdateSchema: z.ZodObject<{
    body: z.ZodObject<{
        originalName: z.ZodString;
        name: z.ZodString;
        image: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        imageFilename: z.ZodOptional<z.ZodString>;
        comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tracking: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        tracking: boolean;
        comment: string;
        image: string;
        originalName: string;
        imageFilename?: string | undefined;
    }, {
        name: string;
        originalName: string;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        name: string;
        tracking: boolean;
        comment: string;
        image: string;
        originalName: string;
        imageFilename?: string | undefined;
    };
}, {
    body: {
        name: string;
        originalName: string;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
    };
}>;
export declare const LabelGetSchema: z.ZodObject<{
    params: z.ZodDefault<z.ZodOptional<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>>>;
}, "strip", z.ZodTypeAny, {
    params: {};
}, {
    params?: {} | undefined;
}>;
export declare const LabelInsertSchema: z.ZodObject<{
    body: z.ZodObject<{
        addr: z.ZodString;
        chains: z.ZodArray<z.ZodString, "many">;
        entity: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        label: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tracking: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        aliases: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            chain: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            chain: string;
        }, {
            name: string;
            chain: string;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
    }, {
        addr: string;
        chains: string[];
        label?: string | undefined;
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
    };
}, {
    body: {
        addr: string;
        chains: string[];
        label?: string | undefined;
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    };
}>;
export declare const LabelUpdateSchema: z.ZodObject<{
    body: z.ZodObject<{
        originalAddr: z.ZodString;
        addr: z.ZodString;
        chains: z.ZodArray<z.ZodString, "many">;
        entity: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        label: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        tracking: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        aliases: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            chain: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            chain: string;
        }, {
            name: string;
            chain: string;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
        originalAddr: string;
    }, {
        addr: string;
        chains: string[];
        originalAddr: string;
        label?: string | undefined;
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
        originalAddr: string;
    };
}, {
    body: {
        addr: string;
        chains: string[];
        originalAddr: string;
        label?: string | undefined;
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    };
}>;
export declare const LabelDeleteSchema: z.ZodObject<{
    body: z.ZodObject<{
        addr: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        addr: string;
    }, {
        addr: string;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        addr: string;
    };
}, {
    body: {
        addr: string;
    };
}>;
export declare const LabelInsertBulkSchema: z.ZodObject<{
    body: z.ZodArray<z.ZodObject<{
        addr: z.ZodString;
        chains: z.ZodArray<z.ZodString, "many">;
        entity: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        comment: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        label: z.ZodString;
        tracking: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        aliases: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            chain: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            chain: string;
        }, {
            name: string;
            chain: string;
        }>, "many">>>;
    }, "strip", z.ZodTypeAny, {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
    }, {
        label: string;
        addr: string;
        chains: string[];
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    body: {
        label: string;
        addr: string;
        entity: string;
        tracking: boolean;
        comment: string;
        chains: string[];
        aliases: {
            name: string;
            chain: string;
        }[];
    }[];
}, {
    body: {
        label: string;
        addr: string;
        chains: string[];
        entity?: string | undefined;
        tracking?: boolean | undefined;
        comment?: string | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
    }[];
}>;
export declare const LabelDeleteBulkSchema: z.ZodObject<{
    address: z.ZodUnion<[z.ZodString, z.ZodArray<z.ZodString, "many">]>;
    key: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    address: string | string[];
    key?: string | undefined;
}, {
    address: string | string[];
    key?: string | undefined;
}>;
export declare const AlertRuleSchema: z.ZodAny;
export declare const ChainInsertSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    body: z.ZodObject<{
        caip2: z.ZodString;
        name: z.ZodString;
        symbol: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
        chainId: z.ZodOptional<z.ZodNumber>;
        isTestnet: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        gasPriceGwei: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        rpc: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodLiteral<"placeholder">]>, "many">>;
        wsRpc: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodLiteral<"placeholder">]>, "many">>;
        blockExplorerPrefix: z.ZodString;
        bgColor: z.ZodString;
        fontColor: z.ZodEnum<["#EFEFEF", "#303030"]>;
        addrRegexPatterns: z.ZodArray<z.ZodString, "many">;
        addrCaseSensitive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        memoRequired: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        memoRegexPatterns: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        block_time: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        annotation: z.ZodObject<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        status: z.ZodDefault<z.ZodOptional<z.ZodEnum<["active", "deprecated"]>>>;
        supersededBy: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    }, {
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>, {
    body: {
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>, {
    body: {
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>;
export declare const ChainUpdateSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    body: z.ZodObject<{
        _id: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, string | number, string | number>;
        caip2: z.ZodString;
        name: z.ZodString;
        code: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
        symbol: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
        chainId: z.ZodOptional<z.ZodNumber>;
        isTestnet: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        gasPriceGwei: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        rpc: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodLiteral<"placeholder">]>, "many">>;
        wsRpc: z.ZodOptional<z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodLiteral<"placeholder">]>, "many">>;
        blockExplorerPrefix: z.ZodString;
        bgColor: z.ZodString;
        fontColor: z.ZodEnum<["#EFEFEF", "#303030"]>;
        addrRegexPatterns: z.ZodArray<z.ZodString, "many">;
        addrCaseSensitive: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        memoRequired: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        memoRegexPatterns: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
        block_time: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        annotation: z.ZodObject<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            geckoterminal: z.ZodOptional<z.ZodString>;
            code: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        status: z.ZodDefault<z.ZodOptional<z.ZodEnum<["active", "deprecated"]>>>;
        supersededBy: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        _id: string | number;
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    }, {
        _id: string | number;
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        _id: string | number;
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        _id: string | number;
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>, {
    body: {
        _id: string | number;
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        _id: string | number;
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>, {
    body: {
        _id: string | number;
        name: string;
        status: "active" | "deprecated";
        caip2: string;
        isTestnet: boolean;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        addrCaseSensitive: boolean;
        memoRequired: boolean;
        memoRegexPatterns: string[];
        block_time: number;
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        chainId?: number | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        supersededBy?: string | undefined;
    };
}, {
    body: {
        _id: string | number;
        name: string;
        caip2: string;
        blockExplorerPrefix: string;
        bgColor: string;
        fontColor: "#EFEFEF" | "#303030";
        addrRegexPatterns: string[];
        annotation: {
            code: string;
            geckoterminal?: string | undefined;
        } & {
            [k: string]: unknown;
        };
        symbol?: string | undefined;
        code?: string | undefined;
        status?: "active" | "deprecated" | undefined;
        chainId?: number | undefined;
        isTestnet?: boolean | undefined;
        gasPriceGwei?: number | null | undefined;
        rpc?: string[] | undefined;
        wsRpc?: string[] | undefined;
        addrCaseSensitive?: boolean | undefined;
        memoRequired?: boolean | undefined;
        memoRegexPatterns?: string[] | undefined;
        block_time?: number | undefined;
        supersededBy?: string | undefined;
    };
}>;
export declare const ChainDeleteSchema: z.ZodObject<{
    body: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    body: {
        name: string;
    };
}, {
    body: {
        name: string;
    };
}>;
export declare const DwStatusBodySchema: z.ZodObject<{
    exchange: z.ZodString;
    network: z.ZodEffects<z.ZodString, string, string>;
    ticker: z.ZodString;
    status: z.ZodEnum<["both", "deposit_only", "withdraw_only", "suspended"]>;
}, "strip", z.ZodTypeAny, {
    ticker: string;
    exchange: string;
    status: "both" | "deposit_only" | "withdraw_only" | "suspended";
    network: string;
}, {
    ticker: string;
    exchange: string;
    status: "both" | "deposit_only" | "withdraw_only" | "suspended";
    network: string;
}>;
export declare const DwDeepDiveTaskSchema: z.ZodObject<{
    ticker: z.ZodString;
    exchanges: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    exchanges: string[];
    ticker: string;
}, {
    exchanges: string[];
    ticker: string;
}>;
export declare const DraftLabelFormSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
    entity: z.ZodOptional<z.ZodString>;
    track: z.ZodOptional<z.ZodBoolean>;
    chains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    aliases: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        chain: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        chain: string;
    }, {
        name: string;
        chain: string;
    }>, "many">>>;
    editingAddr: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    aliases: {
        name: string;
        chain: string;
    }[];
    name?: string | undefined;
    entity?: string | undefined;
    comment?: string | undefined;
    chains?: string[] | undefined;
    address?: string | undefined;
    track?: boolean | undefined;
    editingAddr?: string | undefined;
}, {
    name?: string | undefined;
    entity?: string | undefined;
    comment?: string | undefined;
    chains?: string[] | undefined;
    aliases?: {
        name: string;
        chain: string;
    }[] | undefined;
    address?: string | undefined;
    track?: boolean | undefined;
    editingAddr?: string | undefined;
}>;
export declare const DraftEntityFormSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
    track: z.ZodOptional<z.ZodBoolean>;
    image: z.ZodOptional<z.ZodString>;
    imageFilename: z.ZodOptional<z.ZodString>;
    editingId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    comment?: string | undefined;
    image?: string | undefined;
    imageFilename?: string | undefined;
    track?: boolean | undefined;
    editingId?: string | undefined;
}, {
    name?: string | undefined;
    comment?: string | undefined;
    image?: string | undefined;
    imageFilename?: string | undefined;
    track?: boolean | undefined;
    editingId?: string | undefined;
}>;
export declare const DraftChainFormSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    namespace: z.ZodOptional<z.ZodString>;
    reference: z.ZodOptional<z.ZodString>;
    symbol: z.ZodOptional<z.ZodString>;
    isTestnet: z.ZodOptional<z.ZodBoolean>;
    gasPrice: z.ZodOptional<z.ZodString>;
    explorerPrefix: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodString>;
    supersededBy: z.ZodOptional<z.ZodString>;
    bgType: z.ZodOptional<z.ZodString>;
    bgColorStart: z.ZodOptional<z.ZodString>;
    bgColorMid: z.ZodOptional<z.ZodString>;
    bgColorEnd: z.ZodOptional<z.ZodString>;
    fontColor: z.ZodOptional<z.ZodString>;
    regex: z.ZodOptional<z.ZodString>;
    caseSensitive: z.ZodOptional<z.ZodBoolean>;
    rpcs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    wsRpcs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    annotations: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    editingId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    symbol?: string | undefined;
    name?: string | undefined;
    status?: string | undefined;
    isTestnet?: boolean | undefined;
    fontColor?: string | undefined;
    supersededBy?: string | undefined;
    editingId?: string | undefined;
    namespace?: string | undefined;
    reference?: string | undefined;
    gasPrice?: string | undefined;
    explorerPrefix?: string | undefined;
    bgType?: string | undefined;
    bgColorStart?: string | undefined;
    bgColorMid?: string | undefined;
    bgColorEnd?: string | undefined;
    regex?: string | undefined;
    caseSensitive?: boolean | undefined;
    rpcs?: string[] | undefined;
    wsRpcs?: string[] | undefined;
    annotations?: Record<string, string> | undefined;
}, {
    symbol?: string | undefined;
    name?: string | undefined;
    status?: string | undefined;
    isTestnet?: boolean | undefined;
    fontColor?: string | undefined;
    supersededBy?: string | undefined;
    editingId?: string | undefined;
    namespace?: string | undefined;
    reference?: string | undefined;
    gasPrice?: string | undefined;
    explorerPrefix?: string | undefined;
    bgType?: string | undefined;
    bgColorStart?: string | undefined;
    bgColorMid?: string | undefined;
    bgColorEnd?: string | undefined;
    regex?: string | undefined;
    caseSensitive?: boolean | undefined;
    rpcs?: string[] | undefined;
    wsRpcs?: string[] | undefined;
    annotations?: Record<string, string> | undefined;
}>;
export declare const ExtensionFormDraftSchema: z.ZodObject<{
    labels: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        comment: z.ZodOptional<z.ZodString>;
        entity: z.ZodOptional<z.ZodString>;
        track: z.ZodOptional<z.ZodBoolean>;
        chains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        aliases: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            chain: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            chain: string;
        }, {
            name: string;
            chain: string;
        }>, "many">>>;
        editingAddr: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        aliases: {
            name: string;
            chain: string;
        }[];
        name?: string | undefined;
        entity?: string | undefined;
        comment?: string | undefined;
        chains?: string[] | undefined;
        address?: string | undefined;
        track?: boolean | undefined;
        editingAddr?: string | undefined;
    }, {
        name?: string | undefined;
        entity?: string | undefined;
        comment?: string | undefined;
        chains?: string[] | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
        address?: string | undefined;
        track?: boolean | undefined;
        editingAddr?: string | undefined;
    }>>;
    entities: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        comment: z.ZodOptional<z.ZodString>;
        track: z.ZodOptional<z.ZodBoolean>;
        image: z.ZodOptional<z.ZodString>;
        imageFilename: z.ZodOptional<z.ZodString>;
        editingId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name?: string | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
        track?: boolean | undefined;
        editingId?: string | undefined;
    }, {
        name?: string | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
        track?: boolean | undefined;
        editingId?: string | undefined;
    }>>;
    chains: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        namespace: z.ZodOptional<z.ZodString>;
        reference: z.ZodOptional<z.ZodString>;
        symbol: z.ZodOptional<z.ZodString>;
        isTestnet: z.ZodOptional<z.ZodBoolean>;
        gasPrice: z.ZodOptional<z.ZodString>;
        explorerPrefix: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodString>;
        supersededBy: z.ZodOptional<z.ZodString>;
        bgType: z.ZodOptional<z.ZodString>;
        bgColorStart: z.ZodOptional<z.ZodString>;
        bgColorMid: z.ZodOptional<z.ZodString>;
        bgColorEnd: z.ZodOptional<z.ZodString>;
        fontColor: z.ZodOptional<z.ZodString>;
        regex: z.ZodOptional<z.ZodString>;
        caseSensitive: z.ZodOptional<z.ZodBoolean>;
        rpcs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        wsRpcs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        annotations: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        editingId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        symbol?: string | undefined;
        name?: string | undefined;
        status?: string | undefined;
        isTestnet?: boolean | undefined;
        fontColor?: string | undefined;
        supersededBy?: string | undefined;
        editingId?: string | undefined;
        namespace?: string | undefined;
        reference?: string | undefined;
        gasPrice?: string | undefined;
        explorerPrefix?: string | undefined;
        bgType?: string | undefined;
        bgColorStart?: string | undefined;
        bgColorMid?: string | undefined;
        bgColorEnd?: string | undefined;
        regex?: string | undefined;
        caseSensitive?: boolean | undefined;
        rpcs?: string[] | undefined;
        wsRpcs?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
    }, {
        symbol?: string | undefined;
        name?: string | undefined;
        status?: string | undefined;
        isTestnet?: boolean | undefined;
        fontColor?: string | undefined;
        supersededBy?: string | undefined;
        editingId?: string | undefined;
        namespace?: string | undefined;
        reference?: string | undefined;
        gasPrice?: string | undefined;
        explorerPrefix?: string | undefined;
        bgType?: string | undefined;
        bgColorStart?: string | undefined;
        bgColorMid?: string | undefined;
        bgColorEnd?: string | undefined;
        regex?: string | undefined;
        caseSensitive?: boolean | undefined;
        rpcs?: string[] | undefined;
        wsRpcs?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
    }>>;
    activeTab: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    chains?: {
        symbol?: string | undefined;
        name?: string | undefined;
        status?: string | undefined;
        isTestnet?: boolean | undefined;
        fontColor?: string | undefined;
        supersededBy?: string | undefined;
        editingId?: string | undefined;
        namespace?: string | undefined;
        reference?: string | undefined;
        gasPrice?: string | undefined;
        explorerPrefix?: string | undefined;
        bgType?: string | undefined;
        bgColorStart?: string | undefined;
        bgColorMid?: string | undefined;
        bgColorEnd?: string | undefined;
        regex?: string | undefined;
        caseSensitive?: boolean | undefined;
        rpcs?: string[] | undefined;
        wsRpcs?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
    } | undefined;
    labels?: {
        aliases: {
            name: string;
            chain: string;
        }[];
        name?: string | undefined;
        entity?: string | undefined;
        comment?: string | undefined;
        chains?: string[] | undefined;
        address?: string | undefined;
        track?: boolean | undefined;
        editingAddr?: string | undefined;
    } | undefined;
    entities?: {
        name?: string | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
        track?: boolean | undefined;
        editingId?: string | undefined;
    } | undefined;
    activeTab?: string | undefined;
}, {
    chains?: {
        symbol?: string | undefined;
        name?: string | undefined;
        status?: string | undefined;
        isTestnet?: boolean | undefined;
        fontColor?: string | undefined;
        supersededBy?: string | undefined;
        editingId?: string | undefined;
        namespace?: string | undefined;
        reference?: string | undefined;
        gasPrice?: string | undefined;
        explorerPrefix?: string | undefined;
        bgType?: string | undefined;
        bgColorStart?: string | undefined;
        bgColorMid?: string | undefined;
        bgColorEnd?: string | undefined;
        regex?: string | undefined;
        caseSensitive?: boolean | undefined;
        rpcs?: string[] | undefined;
        wsRpcs?: string[] | undefined;
        annotations?: Record<string, string> | undefined;
    } | undefined;
    labels?: {
        name?: string | undefined;
        entity?: string | undefined;
        comment?: string | undefined;
        chains?: string[] | undefined;
        aliases?: {
            name: string;
            chain: string;
        }[] | undefined;
        address?: string | undefined;
        track?: boolean | undefined;
        editingAddr?: string | undefined;
    } | undefined;
    entities?: {
        name?: string | undefined;
        comment?: string | undefined;
        image?: string | undefined;
        imageFilename?: string | undefined;
        track?: boolean | undefined;
        editingId?: string | undefined;
    } | undefined;
    activeTab?: string | undefined;
}>;
export type DraftLabelForm = z.infer<typeof DraftLabelFormSchema>;
export type DraftEntityForm = z.infer<typeof DraftEntityFormSchema>;
export type DraftChainForm = z.infer<typeof DraftChainFormSchema>;
export type ExtensionFormDraft = z.infer<typeof ExtensionFormDraftSchema>;
