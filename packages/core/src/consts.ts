export const CHROME_IMPERSONATIONS = [
  "chrome99",
  "chrome100",
  "chrome101",
  "chrome104",
  "chrome107",
  "chrome110",
  "chrome116",
  "chrome119",
  "chrome120",
  "chrome123",
  "chrome124",
] as const;

export const EDGE_IMPERSONATIONS = ["edge99", "edge101"] as const;
export const FIREFOX_IMPERSONATIONS = [
  "ff95",
  "ff98",
  "ff100",
  "ff102",
  "ff109",
  "ff117",
] as const;
export const MAC_IMPERSONATIONS = ["safari15_3", "safari15_5"] as const;

// Network names in my format
export const Networks_ETH = "ETH";
export const Networks_BTC = "BTC";
export const Networks_BTCLIGHT = "BTCLIGHT";
export const Networks_BSC = "BSC";
export const Networks_BEP2 = "BEP2";
export const Networks_OPBNB = "OPBNB";
export const Networks_POL = "POL";
export const Networks_AVAXC = "AVAXC";
export const Networks_AVAXX = "AVAXX";
export const Networks_ARB = "ARB";
export const Networks_ARBNOVA = "ARBNOVA";
export const Networks_OP = "OP";
export const Networks_TRX = "TRX";
export const Networks_FTM = "FTM";
export const Networks_CRO = "CRO";
export const Networks_KLAY = "KAIA";
export const Networks_REI = "REI";
export const Networks_GNO = "XDAI";
export const Networks_GLMR = "GLMR";
export const Networks_CELO = "CELO";
export const Networks_BASE = "BASE";
export const Networks_LINEA = "LINEA";
export const Networks_FLOW = "FLOW";
export const Networks_ARK = "ARK";
export const Networks_AERGO = "AERGO";
export const Networks_SOL = "SOL";
export const Networks_APT = "APT";
export const Networks_SUI = "SUI";
export const Networks_NEAR = "NEAR";
export const Networks_AURORA = "AURORA";
export const Networks_CHZOLD = "CHZ";
export const Networks_CHZ = "CHZ2";
export const Networks_OAS = "OAS";
export const Networks_WEMIX = "WEMIX";
export const Networks_KROMA = "KROMA";
export const Networks_BORA = "BORA";
export const Networks_ZKS = "ZKSYNC";
export const Networks_ZKSLITE = "ZKSYNCLITE";
export const Networks_STARKNET = "STARK";
export const Networks_SCROLL = "SCROLL";
export const Networks_POLZKEVM = "POLZKEVM";
export const Networks_MANTA = "MANTAPACIFIC";
export const Networks_MNT = "MANTLE";
export const Networks_MINA = "MINA";
export const Networks_HVH = "HVH";
export const Networks_ATOM = "ATOM";
export const Networks_SEI = "SEI";
export const Networks_TIA = "TIA";
export const Networks_TON = "TON";
export const Networks_LUNC = "LUNC";
export const Networks_LUNA = "LUNA";
export const Networks_ONE = "ONE";
export const Networks_RON = "RON";
export const Networks_XRP = "XRP";
export const Networks_STX = "STX";
export const Networks_WAX = "WAX";
export const Networks_DOGE = "DOGE";
export const Networks_BCH = "BCH";
export const Networks_KSM = "KSM";
export const Networks_ADA = "ADA";
export const Networks_TAIKO = "TAIKO";
export const Networks_POLYX = "POLYX";
export const Networks_AVAIL = "AVAIL";
export const Networks_BB = "BB";
export const Networks_CTK = "CTK";
export const Networks_XPLA = "XPLA";

export const CHAIN_LIST = [
  Networks_ETH,
  Networks_BTC,
  Networks_BTCLIGHT,
  Networks_BSC,
  Networks_BEP2,
  Networks_OPBNB,
  Networks_POL,
  Networks_AVAXC,
  Networks_AVAXX,
  Networks_ARB,
  Networks_ARBNOVA,
  Networks_OP,
  Networks_TRX,
  Networks_FTM,
  Networks_CRO,
  Networks_KLAY,
  Networks_REI,
  Networks_GNO,
  Networks_GLMR,
  Networks_CELO,
  Networks_BASE,
  Networks_LINEA,
  Networks_FLOW,
  Networks_ARK,
  Networks_AERGO,
  Networks_SOL,
  Networks_APT,
  Networks_SUI,
  Networks_NEAR,
  Networks_AURORA,
  Networks_CHZOLD,
  Networks_CHZ,
  Networks_OAS,
  Networks_WEMIX,
  Networks_KROMA,
  Networks_BORA,
  Networks_ZKS,
  Networks_ZKSLITE,
  Networks_STARKNET,
  Networks_SCROLL,
  Networks_POLZKEVM,
  Networks_MANTA,
  Networks_MNT,
  Networks_MINA,
  Networks_HVH,
  Networks_ATOM,
  Networks_SEI,
  Networks_TIA,
  Networks_TON,
  Networks_LUNC,
  Networks_LUNA,
  Networks_ONE,
  Networks_RON,
  Networks_XRP,
  Networks_STX,
  Networks_WAX,
  Networks_DOGE,
  Networks_BCH,
  Networks_KSM,
  Networks_ADA,
  Networks_TAIKO,
  Networks_POLYX,
  Networks_AVAIL,
  Networks_BB,
  Networks_CTK,
  Networks_XPLA,
] as const;

export const MEMO_CHAIN = [
  Networks_XRP,
  Networks_ATOM,
  Networks_TON,
  Networks_WAX,
  Networks_CTK,
  Networks_SEI,
  Networks_XPLA,
] as const;
