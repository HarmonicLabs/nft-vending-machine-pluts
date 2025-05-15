import { BrowserWallet, IWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataConstr, DataI, TxOutRef } from "@harmoniclabs/plu-ts";
import { fromAscii } from "@harmoniclabs/uint8array-utils";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { getFinalContract } from "../../contracts/nftVendingMachine";
import getTxBuilder from "./getTxBuilder";
import { Emulator } from "@harmoniclabs/pluts-emulator";
import { vkeyWitnessFromSignData } from "./commons";

export interface InitResponse {
  txHash: string;
  utxoRef: TxOutRef;
}

export async function init(wallet: BrowserWallet | IWallet, provider: Emulator | BlockfrostPluts | null, isEmulator: boolean): Promise<InitResponse> {

  if (!provider) {
    throw new Error("no Emulator/Blockfrost provider");
  }

  const recipient = Address.fromString(
    await wallet.getChangeAddress()
  );

  const txBuilder = await getTxBuilder(provider);

  const myUTxOs = await provider.getUtxos(recipient);
  if (myUTxOs.length === 0) {
    throw new Error(isEmulator ? "No UTxOs have been found at this address on the emulated ledger" : "Have you requested funds from the faucet?");
  }

  const paramUtxo = myUTxOs.find(u => u.resolved.value.lovelaces >= 15_000_000);

  if (paramUtxo === undefined) {
    throw new Error("not enough ada");
  }

  const {
    script,
    testnetAddress: scriptTestnetAddr
  } = getFinalContract(paramUtxo.utxoRef);

  const tokenName = fromAscii('TestToken');
  const contractHash = scriptTestnetAddr.paymentCreds.hash;

  const mintedNftValue = Value.singleAsset(
    contractHash,
    tokenName,
    1
  );

  const unsignedTx = txBuilder.buildSync({
    inputs: [ paramUtxo ],
    mints: [{
      value: mintedNftValue,
      script: {
        inline: script,
        policyId: contractHash,
        redeemer: new DataConstr(2, []) // Init redeemer to mint the nft
      }
    }],
    outputs: [{
      address: scriptTestnetAddr,
      value: Value.add(
        Value.lovelaces(10_000_000),
        mintedNftValue
      ),
      datum: new DataI(0),
    }],
    changeAddress: recipient,
    collaterals: [paramUtxo],
    collateralReturn: {
      address: paramUtxo.resolved.address,
      value: Value.sub(paramUtxo.resolved.value, Value.lovelaces(5_000_000))
    },
  });

  // Sign the tx body hash
  const txHashHex = unsignedTx.body.hash.toString();
  // Build the witness set data
  const {key, signature} = await wallet.signData(txHashHex, recipient.toString());
  const witness = vkeyWitnessFromSignData(key, signature);

  // inject it to the unsigned tx
  unsignedTx.addVKeyWitness(witness);

  const txHash = await provider.submitTx(unsignedTx);
  console.log("Transaction Hash:", txHash);

  if (isEmulator && provider instanceof Emulator) {
    provider.awaitBlock(1);
    const ledgerState = provider.prettyPrintLedgerState(true);
    console.log("Ledger State:", ledgerState);
  }
  
  return {
    txHash,
    utxoRef: paramUtxo.utxoRef
  };
}
