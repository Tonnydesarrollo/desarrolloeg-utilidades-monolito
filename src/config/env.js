import dotenv from "dotenv";

dotenv.config({ override: true });

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4100)
};
