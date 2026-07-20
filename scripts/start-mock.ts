import { startNessieMockServer } from "../src/nessie-mock/server.js";

const port = Number(process.env.NESSIE_MOCK_PORT ?? "4173");
startNessieMockServer(port);
