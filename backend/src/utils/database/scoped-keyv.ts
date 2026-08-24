import baseDb from "./keyv";
import { scopedKey } from "../user-context";

const db = {
  get(key: string) {
    return baseDb.get(scopedKey(key));
  },
  set(key: string, value: unknown) {
    return baseDb.set(scopedKey(key), value);
  },
  delete(key: string) {
    return baseDb.delete(scopedKey(key));
  },
};

export default db;
