import { v4 as uuidv4 } from "uuid";

export function newId(): string {
  return "w" + uuidv4().slice(0, 8);
}

export function newDatasetId(): string {
  return "ds" + uuidv4().slice(0, 8);
}
