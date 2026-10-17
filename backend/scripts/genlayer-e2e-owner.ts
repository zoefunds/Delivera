// Owner-only StudioNet writes for the remediation E2E. Loads the already
// configured local deployer key without logging or persisting key material.
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address, CalldataEncodable } from "genlayer-js/types";

dotenv.config({ path: "../contracts/base/.env" });

let key = process.env.BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY;
if (process.env.E2E_KEYSTORE) {
  const wallet = await Wallet.fromEncryptedJson(
    readFileSync(process.env.E2E_KEYSTORE, "utf8"),
    process.env.E2E_KEYSTORE_PASSWORD || "",
  );
  key = wallet.privateKey;
}
if (!key) throw new Error("No signing key source is configured");
const normalizedKey = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;

const method = process.env.E2E_METHOD;
const args = JSON.parse(process.env.E2E_ARGS || "[]") as CalldataEncodable[];
if (!method) throw new Error("E2E_METHOD is required");

const client = createClient({ chain: studionet, account: createAccount(normalizedKey) });
const hash = await client.writeContract({
  address: "0xB19331f411618Abb253a01Fa5b457D910c92D8F6" as Address,
  functionName: method,
  args,
  value: 0n,
});
const receipt = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 200, interval: 3000 });
console.log(JSON.stringify({ method, hash, status: receipt.status_name ?? receipt.status, result: receipt.result }, null, 2));
