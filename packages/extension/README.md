# Multichain Address Labeller Browser Extension

## Structure
```
src/
├── background/      # Service worker scripts
├── content/         # Content scripts (DOM manipulation)
├── popup/           # Extension popup UI
├── settings/        # Settings page
├── shared/          # Shared classes & constants (Labels, Entities)
├── services/        # Business logic (chain services)
├── utils/           # Utility functions (modal)
└── vendor/          # Third-party libraries (web3, blockies)
```

## TypeScript Paths
- `@/*` - Root src directory
- `@shared/*` - Shared classes and constants
- `@utils/*` - Utility functions
- `@services/*` - Business services