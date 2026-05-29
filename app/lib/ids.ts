import { customAlphabet } from "nanoid";

const alphanumeric =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const newDocId = customAlphabet(alphanumeric, 12);
export const newTabId = customAlphabet(alphanumeric, 12);
export const newEditToken = customAlphabet(alphanumeric, 24);
export const newSessionId = customAlphabet(alphanumeric, 32);
export const newMagicToken = customAlphabet(alphanumeric, 40);
