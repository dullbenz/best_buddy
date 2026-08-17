import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import idl from "./idl/buddy_distributor.json";

/**
 * Anchor client for the distributor.
 *
 * Returns a read-only program when no wallet is connected, so the public
 * dashboard renders for visitors who never connect anything. The transparency
 * view should not require a wallet.
 */
export function useProgram(): Program<any> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    const provider = new AnchorProvider(
      connection,
      wallet ?? ({ publicKey: null } as any),
      { commitment: "confirmed" }
    );
    try {
      return new Program(idl as any, provider) as Program<any>;
    } catch {
      return null;
    }
  }, [connection, wallet]);
}
