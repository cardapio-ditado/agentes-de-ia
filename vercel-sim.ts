import { createServer } from "node:http";
import handler from "./api/index.js";
const s = createServer((req, res) => handler(req, res));
s.listen(3115, () => console.log("simulador da Vercel na 3115"));
