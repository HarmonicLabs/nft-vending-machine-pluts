import { BrowserWallet } from "@meshsdk/core";
import { Value, Address, Tx, DataConstr, DataI, TxOutRef } from "@harmoniclabs/plu-ts";
import { fromAscii } from "@harmoniclabs/uint8array-utils";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { getFinalContract } from "../../contracts/nftVendingMachine";
import { toPlutsUtxo } from "./mesh-utils";
import getTxBuilder from "./getTxBuilder";

export interface InitResponse {
  tx: string;
  utxoRef: TxOutRef;
}

export async function init(wallet: BrowserWallet, projectId: string): Promise<InitResponse> {

  const recipient = Address.fromString(
    await wallet.getChangeAddress()
  );

  const Blockfrost = new BlockfrostPluts({ projectId });

  const txBuilder = await getTxBuilder(Blockfrost);
  const myUTxOs = (await wallet.getUtxos()).map(toPlutsUtxo);

  if (myUTxOs.length === 0) {
    throw new Error("have you requested founds from the faucet?");
  }

  const paramUtxo = myUTxOs.find(u => u.resolved.value.lovelaces > 15_000_000);

  if (paramUtxo === undefined) {
    throw new Error("not enough ada");
  }

  const {
    script,
    testnetAddress: scriptTestnetAddr
  } = getFinalContract(paramUtxo.utxoRef);

  const tokenName = fromAscii('Test Token');
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

  const txStr = await wallet.signTx(unsignedTx.toCbor().toString());

  const txWit = Tx.fromCbor(txStr).witnesses.vkeyWitnesses ?? [];
  for (const wit of txWit) {
    unsignedTx.addVKeyWitness(wit);
  }

  const tx = await Blockfrost.submitTx(unsignedTx);
  
  return {
    tx,
    utxoRef: paramUtxo.utxoRef
  };
}
