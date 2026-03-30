import { google } from "googleapis";

export function createDriveClient(auth) {
  return google.drive({ version: "v3", auth });
}
