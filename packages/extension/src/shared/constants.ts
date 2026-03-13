// Display constants
export const BEGINNING_AND_END_CHARS_IN_ADDR_TO_SHOW = 4;

// Form selectors
export const FORM_ADDRESS_SELECTOR = '#label-address';
export const FORM_NAME_SELECTOR = '#label-name';
export const FORM_CHAIN_SELECTOR = '#label-chain';
export const FORM_ENTITY_SELECTOR = '#label-entity';
export const FORM_COMMENT_SELECTOR = '#label-comment';
export const FORM_TRACK_SELECTOR = '#label-track';
export const ENTITY_NAME_SELECTOR = '#entity-name';
export const ENTITY_IMAGE_SELECTOR = '#entity-image';
export const ENTITY_COMMENT_SELECTOR = '#entity-comment';
export const ENTITY_TRACK_SELECTOR = '#entity-track';

// Storage keys
export const LABELLED_ADDRESSES_KEY = "labelledAddresses";
export const ENTITY_ADDRESSES_KEY = "entities";

// API endpoints (per S-3001 should be from env, but extensions use manifest host_permissions)
export const DEV_API_URL = 'http://dev.bemodest.me:25833';
export const PROD_API_URL = 'https://api.bemodest.me';

// MongoDB collections
export const COLLECTION_ADDRS = 'labelAddrs';
export const COLLECTION_ENTITIES = 'labelEntities';

// WebSocket events
export const WS_EVENT_LABEL_GET = 'labelGet';
export const WS_EVENT_LABEL_UPDATE = 'labelUpdate';
export const WS_EVENT_LABEL_INSERT = 'labelInsert';
export const WS_EVENT_LABEL_DELETE = 'labelDelete';
export const WS_EVENT_ENTITY_GET = 'entityGet';
export const WS_EVENT_ENTITY_UPDATE = 'entityUpdate';
export const WS_EVENT_ENTITY_INSERT = 'entityInsert';
export const WS_EVENT_ENTITY_DELETE = 'entityDelete';
export const WS_EVENT_CHAIN_GET = 'chainGet';
export const WS_EVENT_CHAIN_UPDATE = 'chainUpdate';
export const WS_EVENT_SUCCESS = 'success';
export const WS_EVENT_FAILURE = 'failure';
export const WS_EVENT_GET_ERROR = 'get_error';
export const WS_EVENT_STATUS_CHANGE = 'statusChange';

// Connection Statuses
export const WS_STATUS_CONNECTING = 'connecting';
export const WS_STATUS_CONNECTED = 'connected';
export const WS_STATUS_DISCONNECTED = 'disconnected';
export const WS_STATUS_ERROR = 'error';