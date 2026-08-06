import { registerImportProvider } from "./provider";
import { csvBankImportProvider } from "./providers/csv-bank-provider";
import { appleImportProvider } from "./providers/apple-provider";
import { googlePlayImportProvider } from "./providers/google-play-provider";
import { plaidImportProvider } from "./providers/plaid-provider";
import { trueLayerImportProvider } from "./providers/truelayer-provider";
import { gmailImportProvider } from "./providers/gmail-provider";

// Side-effecting: importing this module registers every provider. Imported
// once, at the top of every entry point that needs to resolve a provider
// (the API routes, and the source-picker UI for listing available sources).
registerImportProvider(csvBankImportProvider);
registerImportProvider(appleImportProvider);
// googlePlayImportProvider stays registered (the analyze route's dispatch
// table needs every valid ImportSourceId resolvable, and its existing
// data/tests are still real and correct) but is no longer offered in
// SourcePicker — gmailImportProvider replaces it as the active "Google"
// option per this app's "don't offer a fake connection, do the real one"
// direction. Same isolated-but-present pattern already used for email
// verification elsewhere in this codebase.
registerImportProvider(googlePlayImportProvider);
registerImportProvider(plaidImportProvider);
registerImportProvider(trueLayerImportProvider);
registerImportProvider(gmailImportProvider);
