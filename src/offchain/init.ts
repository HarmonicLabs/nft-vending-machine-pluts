import { BrowserWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataB, DataConstr, UTxO, DataI } from "@harmoniclabs/plu-ts";
import { fromAscii } from "@harmoniclabs/uint8array-utils";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { scriptTestnetAddr, script } from "../../contracts/nftVendingMachine";
import { toPlutsUtxo } from "./mesh-utils";
import getTxBuilder from "./getTxBuilder";

export async function mintNft(wallet: BrowserWallet, projectId: string): Promise<string> {

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

  const tokenName = fromAscii('Test Token');
  const contractHash = scriptTestnetAddr.paymentCreds.hash;

  const unsignedTx = txBuilder.buildSync({
    inputs: [{ utxo }],
    outputs: [{
      address: scriptTestnetAddr,
      value: Value.lovelaces(10_000_000),
      datum: new DataI(0),
    }],
    changeAddress: recipient,
    collaterals: [utxo],
    collateralReturn: {
      address: utxo.resolved.address,
      value: Value.sub(utxo.resolved.value, Value.lovelaces(5_000_000))
    },
    mints: [{
      value: Value.singleAsset(
        contractHash,
        tokenName,
        1
      ),
      script: {
        inline: script,
        policyId: contractHash,
        redeemer: new DataConstr(2, [])
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
