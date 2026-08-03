import { registerImportProvider } from "./provider";
import { csvBankImportProvider } from "./providers/csv-bank-provider";
import { appleImportProvider } from "./providers/apple-provider";
import { googlePlayImportProvider } from "./providers/google-play-provider";

// Side-effecting: importing this module registers every provider. Imported
// once, at the top of every entry point that needs to resolve a provider
// (the API routes, and the source-picker UI for listing available sources).
registerImportProvider(csvBankImportProvider);
registerImportProvider(appleImportProvider);
registerImportProvider(googlePlayImportProvider);
