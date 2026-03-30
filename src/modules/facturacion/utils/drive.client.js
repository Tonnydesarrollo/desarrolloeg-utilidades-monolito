import { google } from "googleapis";
import auth from "./auth.js";

export const drive = google.drive({
  version: "v3",
  auth
});
