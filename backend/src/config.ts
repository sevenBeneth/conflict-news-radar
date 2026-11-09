import dotenv from "dotenv";
import path from "path";
// Root config for native development; Docker injects environment directly.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();
