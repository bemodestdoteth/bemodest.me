import { MongoDBClient } from "./mongoDBClient.js";
import dotenv from 'dotenv';
import fs from 'fs';

const BLACK = "#303030";
const WHITE = "#EFEFEF";

class Chains {
    constructor(name, code, blockExplorerPrefix, blockExplorerPostfix, blockExplorerHasIframe, bgColor, fontColor, addrRegexPatterns, addrCaseSensitive=false) {
        this.name = name;
        this.code = code;
        this.blockExplorerPrefix = blockExplorerPrefix;
        this.blockExplorerPostfix = blockExplorerPostfix;
        this.blockExplorerHasIframe = blockExplorerHasIframe;
        this.bgColor = bgColor;
        this.fontColor = fontColor;
        this.addrRegexPatterns = addrRegexPatterns;
        this.addrCaseSensitive = addrCaseSensitive;
    }

    addDNStoRegexPatterns(suffix) {
        const regex = new RegExp(`(\\.${suffix})(\s|$)`, 'g');
        this.addrRegexPatterns.push(regex);
        return this.addrRegexPatterns.length;
    }
}

class EVM extends Chains {
    constructor(name, code, blockExplorerPrefix, blockExplorerPostfix, blockExplorerHasIframe, bgColor, fontColor) {
        super(
            name,
            code,
            blockExplorerPrefix,
            blockExplorerPostfix,
            blockExplorerHasIframe,
            bgColor,
            fontColor,
            [/(^|\s|:|-)((?:0x)[0-9a-fA-F]{40})(\s|$)/gi]
        );
    }
}

class Ethereum extends EVM {
    constructor() {
        super(
            "Ethereum",
            "ETH",
            "https://etherscan.io/address/",
            "",
            true,
            "#3498DB",
            WHITE
        );
        // ENS
        this.addDNStoRegexPatterns("eth");

        // Unstoppable domains
        this.addDNStoRegexPatterns("888");
        this.addDNStoRegexPatterns("bitcoin");
        this.addDNStoRegexPatterns("blockchain");
        this.addDNStoRegexPatterns("crypto");
        this.addDNStoRegexPatterns("dao");
        this.addDNStoRegexPatterns("nft");
        this.addDNStoRegexPatterns("polygon");
        this.addDNStoRegexPatterns("wallet");
        this.addDNStoRegexPatterns("x");
        this.addDNStoRegexPatterns("zil");
    }
}

class EVMall extends EVM {
    constructor() {
        super(
            "EVMall",
            "EVM_ALL",
            "https://etherscan.io/address/",
            "",
            true,
            "#FAFAFA",
            BLACK
        );
    }
}

class Bitcoin extends Chains {
    constructor() {
        super(
            "Bitcoin",
            "BTC",
            "https://explorer.btc.com/btc/address/",
            "",
            false,
            "#FD9E97",
            BLACK,
            [/(^|\s|:|-)(?:^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^(?:bc1q|bc1p)[0-9A-Za-z]{37,62}$)(\s|$)/g],
            true
        );
    }
}

class BNBChain extends EVM {
    constructor() {
        super(
            "BNBChain",
            "BSC",
            "https://bscscan.com/address/",
            "",
            false,
            "#FFC300",
            BLACK
        );
        // Space ID
        this.addDNStoRegexPatterns("bnb");
    }
}

class OpBNB extends EVM {
    constructor() {
        super(
            "OpBNB",
            "OPBNB",
            "https://opbnb.bscscan.com/address/",
            "",
            false,
            "linear-gradient(to right, #FFC300, #FF5300, #FFC300)",
            BLACK
        );
        // Space ID
        this.addDNStoRegexPatterns("bnb");
    }
}

class Polygon extends EVM {
    constructor() {
        super(
            "Polygon",
            "POL",
            "https://polygonscan.com/address/",
            "",
            false,
            "#8E44AD",
            WHITE
        );
        // Unstoppable domains
        this.addDNStoRegexPatterns("888");
        this.addDNStoRegexPatterns("bitcoin");
        this.addDNStoRegexPatterns("blockchain");
        this.addDNStoRegexPatterns("crypto");
        this.addDNStoRegexPatterns("dao");
        this.addDNStoRegexPatterns("nft");
        this.addDNStoRegexPatterns("polygon");
        this.addDNStoRegexPatterns("wallet");
        this.addDNStoRegexPatterns("x");
        this.addDNStoRegexPatterns("zil");
    }
}

class Avalanche extends EVM {
    constructor() {
        super(
            "Avalanche",
            "AVAXC",
            "https://snowscan.xyz/address/",
            "",
            false,
            "#E74C3C",
            WHITE
        );
    }
}

class Arbitrum extends EVM {
    constructor() {
        super(
            "Arbitrum",
            "ARB",
            "https://arbiscan.io/address/",
            "",
            false,
            "#FF69B4",
            BLACK
        );
        // Space ID
        this.addDNStoRegexPatterns("arb");
    }
}

class ArbitrumNova extends EVM {
    constructor() {
        super(
            "ArbitrumNova",
            "ARBNOVA",
            "https://nova.arbiscan.io/address/",
            "",
            false,
            "linear-gradient(to right, #FF69B4, #EC852D, #FF69B4)",
            BLACK
        );
    }
}

class Optimism extends EVM {
    constructor() {
        super(
            "Optimism",
            "OP",
            "https://optimistic.etherscan.io/address/",
            "",
            false,
            "#FF8C00",
            BLACK
        );
    }
}

class Tron extends Chains {
    constructor() {
        super(
            "Tron",
            "TRX",
            "https://tronscan.org/#/address/",
            "",
            false,
            "#C53228",
            WHITE,
            [/(^|\s|:|-)((?:T)[1-9a-zA-Z]{33})(\s|$)/g],
            true
        );
    }
}

class Fantom extends EVM {
    constructor() {
        super(
            "Fantom",
            "FTM",
            "https://ftmscan.com/address/",
            "",
            false,
            "#7D3C98",
            WHITE
        );
    }
}

class Cronos extends EVM {
    constructor() {
        super(
            "Cronos",
            "CRO",
            "https://cronoscan.com/address/",
            "",
            false,
            "#050505",
            WHITE
        );
        this.addDNStoRegexPatterns("cro");
    }
}

class Klaytn extends EVM {
    constructor() {
        super(
            "Klaytn",
            "KLAY",
            "https://scope.klaytn.com/account/",
            "",
            false,
            "#FF6363",
            WHITE
        );
    }
}

class Rei extends EVM {
    constructor() {
        super(
            "Rei",
            "REI",
            "https://scan.rei.network/address/",
            "",
            false,
            "#2116E5",
            WHITE
        );
    }
}

class Gnosis extends EVM {
    constructor() {
        super(
            "Gnosis",
            "XDAI",
            "https://gnosisscan.io/address/",
            "",
            false,
            "#27AE60",
            WHITE
        );
    }
}

class Moonbeam extends EVM {
    constructor() {
        super(
            "Moonbeam",
            "GLMR",
            "https://moonscan.io/address/",
            "",
            false,
            "#53CBC8",
            BLACK
        );
    }
}

class Celo extends EVM {
    constructor() {
        super(
            "Celo",
            "CELO",
            "https://celoscan.io/address/",
            "",
            false,
            "#FCFF52",
            BLACK
        );
    }
}

class Base extends EVM {
    constructor() {
        super(
            "Base",
            "BASE",
            "https://basescan.org/address/",
            "",
            false,
            "#3C40C6",
            WHITE
        );
        this.addDNStoRegexPatterns("eth"); // .base.eth
    }
}

class Linea extends EVM {
    constructor() {
        super(
            "Linea",
            "LINEA",
            "https://lineascan.build/address/",
            "",
            false,
            "#A5A5A5",
            WHITE
        );
    }
}

class Flow extends Chains {
    constructor() {
        super(
            "Flow",
            "FLOW",
            "https://flowscan.org/account/",
            "",
            false,
            "#00EF8B",
            WHITE,
            [/(^|\s|:|-)((?:0x)[0-9a-fA-F]{16})(\s|$)/gi]
        );
    }
}

class Ark extends Chains {
    constructor() {
        super(
            "Ark",
            "ARK",
            "https://live.arkscan.io/addresses/",
            "",
            false,
            "#DE5846",
            WHITE,
            [/(^|\s|:|-)((A)[A-Za-z0-9]{33})(\s|$)/gi],
            true
        );
    }
}

class Aergo extends Chains {
    constructor() {
        super(
            "Aergo",
            "AERGO",
            "https://mainnet.aergoscan.io/account/",
            "",
            false,
            "linear-gradient(to right, #269DCD, #EA3392)",
            WHITE,
            [/(^|\s|:|-)((Am)[A-Za-z0-9]{50})(\s|$)/gi],
            true
        );
    }
}

class Solana extends Chains {
    constructor() {
        super(
            "Solana",
            "SOL",
            "https://solscan.io/address/",
            "",
            false,
            "linear-gradient(to right, #00FFFF, #006666)",
            BLACK,
            [/(^|\s|:|-)(?!0x)(?:[1-9A-HJ-NP-Za-km-z]{32,44})(\s|$)/g],
            true
        );
        // Solana Name System
        this.addDNStoRegexPatterns("sol");
    }
}

class Aptos extends Chains {
    constructor() {
        super(
            "Aptos",
            "APTOS",
            "https://explorer.aptoslabs.com/account/",
            "",
            false,
            "#404040",
            WHITE,
            [/(^|\s|:|-)((?:0x)[0-9A-Za-z]{64})(\s|$)/g],
        );
    }
}

class Sui extends Chains {
    constructor() {
        super(
            "Sui",
            "SUI",
            "https://suivision.xyz/address/",
            "",
            false,
            "#9B59B6",
            WHITE,
            [/(^|\s|:|-)((?:0x)[0-9A-Za-z]{64})(\s|$)/g],
        );
    }
}

class Near extends Chains {
    constructor() {
        super(
            "Near",
            "NEAR",
            "https://nearblocks.io/address/",
            "",
            false,
            "#DFDFDF",
            BLACK,
            [/^(?!0x)(?!bc1)(?!bnb1)[a-z0-9_-]{1}[a-z0-9_.-]{0,62}[a-z0-9_-]{1}$/g],
            true
        );
        // xxx.near is default address in near blockchain
        this.addDNStoRegexPatterns("near");
    }
}

class Aurora extends EVM {
    constructor() {
        super(
            "Aurora",
            "AURORA",
            "https://explorer.aurora.dev/address/",
            "",
            false,
            "#2ECC71",
            BLACK
        );
    }
}

class Chiliz extends EVM {
    constructor() {
        super(
            "Chiliz",
            "CHZ",
            "https://chiliscan.com/address/",
            "",
            false,
            "#800000",
            WHITE
        );
    }
}

class ChilizOld extends EVM {
    constructor() {
        super(
            "ChilizOld",
            "CHZOLD",
            "https://explorer.chiliz.com/address/",
            "",
            false,
            "#600000",
            WHITE
        );
    }
}

class Core extends EVM {
    constructor() {
        super(
            "Core",
            "CORE",
            "https://scan.coredao.org/address/",
            "",
            false,
            "#FF9500",
            BLACK
        );
    }
}

class Ronin extends EVM {
    constructor() {
        super(
            "Ronin",
            "RON",
            "https://app.roninchain.com/address/",
            "",
            false,
            "linear-gradient(to bottom, #5096ED, #5096ED, #EEF1F5)",
            BLACK
        );
    }
}

class Oasys extends EVM {
    constructor() {
        super(
            "Oasys",
            "OAS",
            "https://scan.oasys.games/address/",
            "",
            false,
            "#00A84F",
            BLACK
        );
    }
}

class Wemix extends EVM {
    constructor() {
        super(
            "Wemix",
            "WEMIX",
            "https://wemixscan.com/address/",
            "",
            false,
            "linear-gradient(to bottom, #FF0099, #8844FF, #0066FF)",
            WHITE
        );
    }
}

class Kroma extends EVM {
    constructor() {
        super(
            "Kroma",
            "ETH",
            "https://kromascan.com/address/",
            "",
            false,
            "#7EE240",
            WHITE
        );
    }
}

class Bora extends EVM {
    constructor() {
        super(
            "Bora",
            "BORA",
            "https://scope.boraportal.com/address/",
            "",
            false,
            "#3361ff",
            WHITE
        );
    }
}

class ZkSyncEra extends EVM {
    constructor() {
        super(
            "ZkSyncEra",
            "ZKSYNC",
            "https://era.zksync.network/address/",
            "",
            false,
            "linear-gradient(to right, #54579A, #3EA1D4, #54579A)",
            WHITE
        );
    }
}

class Starknet extends Chains {
    constructor() {
        super(
            "Starknet",
            "STARK",
            "https://starkscan.co/contract/",
            "",
            false,
            "#8A2BE2",
            WHITE,
            [/(^|\s|:|-)((?:0x)[0-9a-fA-F]{64})(\s|$)/g],
        );
        this.addDNStoRegexPatterns("stark");
    }
}

class Scroll extends EVM {
    constructor() {
        super(
            "Scroll",
            "SCROLL",
            "https://scrollscan.com/address/",
            "",
            false,
            "#EB7106",
            BLACK
        );
    }
}

class Taiko extends EVM {
    constructor() {
        super(
            "Taiko",
            "TAIKO",
            "https://taikoscan.io/address/",
            "",
            false,
            "#E81899",
            WHITE
        );
    }
}

class Zora extends EVM {
    constructor() {
        super(
            "Zora",
            "ZORA",
            "https://zora.superscan.network/address/",
            "",
            false,
            "linear-gradient(to right, #341417, #4c74e9, #eecde6)",
            WHITE
        );
    }
}

class PolygonZkEVM extends EVM {
    constructor() {
        super(
            "PolygonZkEVM",
            "POLZKEVM",
            "https://zkevm.polygonscan.com/address/",
            "",
            false,
            "linear-gradient(to right, #8E44AD, #AA5BF2, #8E44AD)",
            WHITE
        );
    }
}

class MantaPacific extends EVM {
    constructor() {
        super(
            "MantaPacific",
            "MANTAPACIFIC",
            "https://manta.socialscan.io/address/",
            "",
            false,
            "linear-gradient(to right, #0CA2EA, #C670C8, #F368BA)",
            WHITE
        );
    }
}

class Mantle extends EVM {
    constructor() {
        super(
            "Mantle",
            "MANTLE",
            "https://mantlescan.xyz/address/",
            "",
            false,
            "linear-gradient(to right, #256A8B, #4FAAAA, #ABDDDA)",
            WHITE
        );
    }
}

class Blast extends EVM {
    constructor() {
        super(
            "Blast",
            "BLAST",
            "https://blastscan.io/address/",
            "",
            false,
            "linear-gradient(to right, #131313, #FFFC67, #131313)",
            WHITE
        );
    }
}

class Metis extends EVM {
    constructor() {
        super(
            "Metis",
            "METIS",
            "https://explorer.metis.io/address/",
            "",
            false,
            "linear-gradient(to right, #00D2FF, #000000, #00D2FF)",
            WHITE
        );
    }
}

class Vana extends EVM {
    constructor() {
        super(
            "Vana",
            "VANA",
            "https://vanascan.io/address/",
            "",
            false,
            "#E3E1DB",
            BLACK
        );
    }
}

class Mina extends Chains {
    constructor() {
        super(
            "Mina",
            "MINA",
            "https://minaexplorer.com/wallet/",
            "",
            false,
            "linear-gradient(to bottom, #f06, #e66465, #904e95)",
            WHITE,
            [/(^|\s|:|-)((B62)[A-Za-z0-9]{52})(\s|$)/gi],
            true
        );
    }
}

class Havah extends Chains {
    constructor() {
        super(
            "Havah",
            "HVH",
            "https://scan.havah.io/contract/",
            "",
            false,
            "#0F8F6B",
            WHITE,
            [/(^|\s|:|-)((?:hx|cx)[0-9a-fA-F]{40})(\s|$)/gi]
        );
    }
}

class Cosmos extends Chains {
    constructor() {
        super(
            "Cosmos",
            "ATOM",
            "https://www.mintscan.io/cosmos/address/",
            "",
            false,
            "linear-gradient(to bottom, #704DB6, #000000, #704DB6)",
            WHITE,
            [/(^|\s|:|-)(cosmos1[0-9a-z]{38,58})(\s|$)/gi]
        );
    }
}

class Sei extends Chains {
    constructor() {
        super(
            "Sei",
            "SEI",
            "https://www.seiscan.app/pacific-1/accounts/",
            "",
            false,
            "#992C4B",
            WHITE,
            [/(^|\s|:|-)(sei1[0-9a-z]{38,58})(\s|$)/gi]
        );
    }
}

class Celestia extends Chains {
    constructor() {
        super(
            "Celestia",
            "TIA",
            "https://celestia.explorers.guru/account/",
            "",
            false,
            "linear-gradient(to bottom, #7B2BF9, #EFEFEF)",
            BLACK,
            [/(^|\s|:|-)(celestia1[0-9a-z]{38,58})(\s|$)/gi]
        );
    }
}

class Xpla extends Chains {
    constructor() {
        super(
            "Xpla",
            "XPLA",
            "https://explorer.xpla.io/mainnet/address/",
            "",
            false,
            "linear-gradient(to bottom, #00ABFF, #DFDFDF, #00ABFF)",
            BLACK,
            [/(^|\s|:|-)(xpla1[0-9a-z]{38,58})(\s|$)/gi]
        );
    }
}

class Wax extends Chains {
    constructor() {
        super(
            "Wax",
            "WAX",
            "https://wax.eosauthority.com/account/",
            "",
            false,
            "#FCCA44",
            BLACK,
            [/(^|\s|:|-)([1-5a-z\\.]{1,12})(\s|$)/gi],
            true
        );
    }
}

class Elrond extends Chains {
    constructor() {
        super(
            "Elrond",
            "EGLD",
            "https://explorer.multiversx.com/accounts/",
            "",
            false,
            "linear-gradient(to bottom, #000000, #23F6DC, #000000)",
            WHITE,
            [/(^|\s|:|-)((erd)[a-z-A-Z0-9]{59})(\s|$)/gi],
            true
        );
    }
}

const chainClasses = {
    Ethereum,
    EVMall,
    Bitcoin,
    BNBChain,
    OpBNB,
    Polygon,
    Avalanche,
    Arbitrum,
    ArbitrumNova,
    Optimism,
    Tron,
    Fantom,
    Cronos,
    Klaytn,
    Rei,
    Gnosis,
    Moonbeam,
    Celo,
    Base,
    Linea,
    Flow,
    Ark,
    Aergo,
    Solana,
    Aptos,
    Sui,
    Near,
    Aurora,
    Chiliz,
    ChilizOld,
    Core,
    Ronin,
    Oasys,
    Wemix,
    Kroma,
    Bora,
    ZkSyncEra,
    Starknet,
    Scroll,
    Taiko,
    Zora,
    PolygonZkEVM,
    MantaPacific,
    Mantle,
    Blast,
    Metis,
    Vana,
    Mina,
    Havah,
    Cosmos,
    Sei,
    Celestia,
    Xpla,
    Wax,
    Elrond,
};

// Function to create an instance from a string
const createInstance = (className) => {
    const classes = chainClasses;
    const Class = classes[className];
    if (!Class) { throw new Error(`No class found for ${className}`); }  
    return new Class();
}

const getValueForEachChains = (value) => {
    result = [];
    for (const chainClass of Object.values(chainClasses)) {
        result.push(new chainClass()[value]);
    }
    console.log(result);
    return result
}

// window.addEventListener('load', () => {
//     // Mapping object
//     window.createInstance = createInstance;
//     window.getValueForEachChains = getValueForEachChains;
// });

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });
console.log(`Current environment file: ${envFile} | Current environment: ${process.env.NODE_ENV}`);

const extractInstancesAsJSON = async () => {
    const chainInstances = [];
    let idnum = 0;

    for (const [className, ChainClass] of Object.entries(chainClasses)) {
        try {
            const instance = new ChainClass();
            // Collect all properties of the instance
            const properties = Object.entries(instance).reduce((acc, [key, value]) => {
                acc[key] = value;
                return acc;
            }, {});
            properties["_id"] = idnum;
            properties["addrRegexPatterns"] = properties["addrRegexPatterns"].map((regex) => regex.toString());
            chainInstances.push(properties);

            idnum += 1;
        } catch (err) {
            console.log(idnum)
            console.error(`Failed to create instance for ${className}:`, err);
        }
    }

    const dbClient = new MongoDBClient();
    await dbClient.connect();
    for (const chainInstance of chainInstances) {
        console.log(chainInstance);
        await dbClient.createOne("chains", chainInstance);
    }
    dbClient.close();
};

const extractEntitiesAsJSON = async () => {
    const entityInstances = [{
        "_id": 0,
        "tracking": false,
        "image": "",
        "comment": "",
        "name": "No Entity",
    }];
    let idnum = 1;

    fs.readFile('./src/entities.json', 'utf8', (err, data) => {
        if (err) {
            console.error(err);
            return;
        }
        const entityJson = JSON.parse(data);
        for (const [entityName, entityObj] of Object.entries(entityJson[0].entities)) {
            try {
                entityObj["_id"] = idnum;
                entityObj["name"] = entityName;
                delete entityObj["code"];
                entityInstances.push(entityObj);    
                idnum += 1;
            } catch (err) {
                console.log(idnum)
                console.error(`Failed to create instance for ${className}:`, err);
            }
        }
    });

    const dbClient = new MongoDBClient();
    await dbClient.connect();
    for (const entityInstance of entityInstances) {
        console.log(entityInstance);
        await dbClient.createOne("labelEntities", entityInstance);
    }
    dbClient.close();
};
const test = async () => {
    const dbClient = new MongoDBClient();
    await dbClient.connect();
    const labelAddrs = await dbClient.readMany("labelAddrs", {});
    const labelEntities = await dbClient.readMany("labelEntities", {});

    const labelEntitiesMap = new Map();
    for (const entity of labelEntities) {
        labelEntitiesMap.set(entity.code, entity);
    }

    for (const addr of labelAddrs) {
        if (labelEntitiesMap.has(addr.entity)) {
            addr.entity = labelEntitiesMap.get(addr.entity).name;
        }
    }
    console.log(labelAddrs[0]);

    await dbClient.createMany("labelAddrs2", labelAddrs);
    await dbClient.close();
}

extractEntitiesAsJSON();