import { BrowserWallet, IWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataConstr, UTxO, DataI, TxOutRef } from "@harmoniclabs/plu-ts";
import { fromAscii } from "@harmoniclabs/uint8array-utils";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { getFinalContract } from "../../contracts/nftVendingMachine";
import getTxBuilder from "./getTxBuilder";
import { Emulator } from "@harmoniclabs/pluts-emulator";
import { vkeyWitnessFromSignData } from "./commons";

export async function mintNft(wallet: BrowserWallet | IWallet, provider: Emulator | BlockfrostPluts | null, isEmulator: boolean, utxoRef: TxOutRef): Promise<string> {
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
  const utxo = myUTxOs.find(u => u.resolved.value.lovelaces >= 15_000_000);

  if (utxo === undefined) {
    throw new Error("not enough ada");
  }

  const {
    script,
    testnetAddress: scriptTestnetAddr
  } = getFinalContract(utxoRef);

  const tokenNameStr = 'TestToken';
  const tokenName = fromAscii(tokenNameStr);
  const contractHash = scriptTestnetAddr.paymentCreds.hash;
  const contractUTxOs = await provider.addressUtxos(scriptTestnetAddr);
  const contractInput = contractUTxOs.find(utxo => utxo.resolved.value.get(contractHash, tokenName) === BigInt(1));

  if (contractInput === undefined) {
    throw new Error("contract not found");
  }

  const currId = getNftCount(contractInput);
  const mintedNftValue = Value.singleAsset(
    contractHash,
    fromAscii(`${tokenNameStr}#${currId.toString()}`), // depends on the datum
    1
  );

  const unsignedTx = txBuilder.buildSync({
    inputs: [
      { utxo },
      {
        utxo: contractInput,
        inputScript: {
          script: script,
          redeemer: new DataConstr(0, [])
        }
      }
    ],
    outputs: [{
      address: scriptTestnetAddr,
      value: Value.lovelaces(10_000_000),
      datum: new DataI(currId + BigInt(1)), // keep track of token, increment counter
    }],
    changeAddress: recipient,
    collaterals: [utxo],
    collateralReturn: {
      address: utxo.resolved.address,
      value: Value.sub(utxo.resolved.value, Value.lovelaces(5_000_000))
    },
    mints: [{
      value: mintedNftValue,
      script: {
        inline: script,
        policyId: contractHash,
        redeemer: new DataConstr(0, []) // mint action
      }
    }],
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

  return txHash
}

function getNftCount(contractInput: UTxO): bigint {
  const datum = contractInput.resolved.datum;
  if (!(datum instanceof DataI)) throw new Error("invalid datum for nft vending machine");
  return datum.int;
}