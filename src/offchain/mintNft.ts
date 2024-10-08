import { BrowserWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataB, DataConstr } from "@harmoniclabs/plu-ts";
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
  const contractUTxOs = await Blockfrost.addressesUtxos(scriptTestnetAddr);
  const contractInput = contractUTxOs.find(utxo => utxo.resolved.value.get(contractHash, tokenName) === BigInt(1));

  // fetch utxos at contract address -- with the nft
  // tx.input -- thread token policy and asset name
  // specify the redeemer

  const unsignedTx = txBuilder.buildSync({
    inputs: [{
      utxo,
    }],
    outputs: [{
      address: scriptTestnetAddr,
      value: Value.lovelaces(10_000_000),
      datum: new DataB(fromAscii("Mint")), // keep track of token, increment counter
    }],
    changeAddress: recipient,
    collaterals: [utxo],
    collateralReturn: {
      address: utxo.resolved.address,
      value: Value.sub(utxo.resolved.value, Value.lovelaces(5_000_000))
    },
    mints: [{
      value: Value.singleAsset(
        scriptTestnetAddr.paymentCreds.hash,
        Buffer.from('Test Token'), // depends on the datum
        1
      ),
      script: {
        inline: script,
        policyId: scriptTestnetAddr.paymentCreds.hash,
        redeemer: new DataConstr(0, [])
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
