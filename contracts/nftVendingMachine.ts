import {
  Address,
  PScriptContext,
  ScriptType,
  Credential,
  Script,
  bs,
  compile,
  pfn,
  plet,
  unit,
  pmatch,
  perror,
  passert,
  pstruct,
  punIData,
  punsafeConvertType,
  pisEmpty,
  punBData,
  pBool,
} from "@harmoniclabs/plu-ts";

const ASSET_NAME = "Test Token";
const MAX_SUPPLY = 10;

export const MintAction = pstruct({
  Mint: {},
  Burn: {}
})

const contract = pfn([
  bs,
  PScriptContext.type,
], unit)
((threadTokenPolicy, { redeemer, tx, purpose }) => {

  const action = plet(punsafeConvertType(redeemer, MintAction.type));

  return pmatch(purpose)
    .onMinting(({ currencySym }) =>
      pmatch(action)
        .onMint(() =>
          passert.$(
            tx.inputs.some(i => i.resolved.address.credential.hash.eq(currencySym)))
        )
        .onBurn(() => 
          passert.$(
            tx.mint.filter(i => i.fst.eq(currencySym)).head.snd.every(m => m.snd.lt(0)))
        )
    )
    .onSpending(({ utxoRef, datum }) => {
      const maybeInput = tx.inputs.find(i =>
        i.utxoRef.eq(utxoRef).and(
        i.resolved.value.amountOf(threadTokenPolicy, ASSET_NAME).gtEq(1)));

      const input = plet(maybeInput).unwrap;

      const ownHash = punBData.$(input.resolved.address.credential.raw.fields.head);

      const hasOwnershipToken = tx.inputs.some(i =>
        i.resolved.value.amountOf(threadTokenPolicy, ASSET_NAME).gtEq(1));

      const paymentCredential = input.resolved.address.credential;

      const id = punIData.$(datum.unwrap);

      const hasOwnHashAsFirst = pisEmpty.$(tx.mint.tail).and(tx.mint.head.fst.eq(ownHash));

      const ownMintedAssets = plet(tx.mint.head.snd);

      const userName = ownMintedAssets.head.fst;

      const userQuantity = ownMintedAssets.head.snd;

      const assetNameWithId = `${ASSET_NAME}${id}`;

      const hasCorrectName = userName.eq(assetNameWithId);

      const hasCorrectMintingQuantity = userQuantity.eq(1);

      const hasValidSupply = id.lt(MAX_SUPPLY);

      const outputs = tx.outputs.filter(o => o.address.credential.eq(paymentCredential));

      const hasOnlyOneOuput = outputs.length.eq(1);
          
      const hasIncreasedId = pmatch(outputs.head.datum)
        .onInlineDatum(({ datum }) => punIData.$(datum).eq(id.add(1)))
        ._(_ => pBool(false));

      const hasCorrectValue = outputs.head.value.lovelaces.eq(input.resolved.value.lovelaces);

      return passert.$(hasOwnershipToken
        .and(hasOwnHashAsFirst)
        .and(hasCorrectName)
        .and(hasCorrectMintingQuantity)
        .and(hasValidSupply)
        .and(hasOnlyOneOuput)
        .and(hasIncreasedId)
        .and(hasCorrectValue));
    })
    ._(_ => perror(unit));
});

export const compiledContract = compile(contract);

export const script = new Script(
  ScriptType.PlutusV3,
  compiledContract
);

export const scriptTestnetAddr = new Address(
  "testnet",
  Credential.script(script.hash)
);