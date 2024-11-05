import { BrowserWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataConstr, UTxO, DataI, TxOutRef } from "@harmoniclabs/plu-ts";
import { fromAscii } from "@harmoniclabs/uint8array-utils";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { getFinalContract } from "../../contracts/nftVendingMachine";
import { toPlutsUtxo } from "./mesh-utils";
import getTxBuilder from "./getTxBuilder";

export async function mintNft(wallet: BrowserWallet, projectId: string, utxoRef: TxOutRef): Promise<string> {

  const recipient = Address.fromString(
    await wallet.getChangeAddress()
  );

  const Blockfrost = new BlockfrostPluts({ projectId });

  const txBuilder = await getTxBuilder(Blockfrost);
  const myUTxOs = (await wallet.getUtxos()).map(toPlutsUtxo);

  if (myUTxOs.length === 0) {
    throw new Error("have you requested founds from the faucet?");
  }

  const utxo = myUTxOs.find(u => u.resolved.value.lovelaces > 15_000_000);

  if (utxo === undefined) {
    throw new Error("not enough ada");
  }

  const {
    script,
    testnetAddress: scriptTestnetAddr
  } = getFinalContract(utxoRef);

  const tokenNameStr = 'Test Token';
  const tokenName = fromAscii(tokenNameStr);
  const contractHash = scriptTestnetAddr.paymentCreds.hash;
  const contractUTxOs = await Blockfrost.addressesUtxos(scriptTestnetAddr);
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

  const txStr = await wallet.signTx(unsignedTx.toCbor().toString());

  const txWit = Tx.fromCbor(txStr).witnesses.vkeyWitnesses ?? [];
  for (const wit of txWit) {
    unsignedTx.addVKeyWitness(wit);
  }

  return await Blockfrost.submitTx(unsignedTx);
}

function getNftCount(contractInput: UTxO): bigint {
  const datum = contractInput.resolved.datum;
  if (!(datum instanceof DataI)) throw new Error("invalid datum for nft vending machine");
  return datum.int;
}