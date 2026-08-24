import Keyv from "keyv";
import SQLite from "@keyv/sqlite";
import { createCloudflareKeyvStore } from "./keyv-cloudflare";

const isCloud = process.env.STORAGE_BACKEND === "cloudflare";

const db = isCloud
  ? new Keyv({ store: createCloudflareKeyvStore() as any })
  : new Keyv({
      store: new SQLite({ uri: "sqlite://storage/database.sqlite" }),
    });

export default db;
