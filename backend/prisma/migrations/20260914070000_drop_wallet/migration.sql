-- Drop Wallet: the custodial GenLayer signing wallet is gone now that every
-- GenLayer write is signed by the user themselves in the browser with the
-- same wallet used for login and Base Sepolia funding. Nothing in the
-- codebase writes to or reads from this table anymore.
DROP TABLE IF EXISTS "Wallet";
