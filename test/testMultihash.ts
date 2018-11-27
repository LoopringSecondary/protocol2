import ABI = require("ethereumjs-abi");
import ethUtil = require("ethereumjs-util");
import { Bitstream, expectThrow, MultiHashUtil, SignAlgorithm } from "protocol2-js";

const MultihashUtilProxy = artifacts.require("MultihashUtilProxy");

contract("Multihash", (accounts: string[]) => {

  const emptyAddr = "0x0000000000000000000000000000000000000000";

  const util = new MultiHashUtil();

  let multihash: any;

  before(async () => {
    multihash = await MultihashUtilProxy.new();
  });

  describe("Standard Ethereum signing", () => {

    it("should be able to verify signed data", async () => {
      const signer = accounts[1];
      const hash = "0x87af0e69eadbad669423455af52cfad68ab75ec9e86288cf31bac18e9b881d7a";
      const multiHashData = await util.signAsync(SignAlgorithm.Ethereum, new Buffer(hash.slice(2), "hex"), signer);
      console.log("hash", hash);
      console.log("signer", signer);
      console.log("multihash", multiHashData);
      const success = await multihash.verifySignature(signer, hash, multiHashData);
      assert(success, "Signature should be valid");
    });

  });

  describe("EIP712 signing", () => {

    it("should be able to verify signed data", async () => {
      const orderhash = "0xa5040e8f5ea24f4b6c053caaa19c44608e5c33e5f71ad6ee48f97241d597ed3e";
      const privateKey = "0x5b791c6c9f4b7aa95ccb58f0f939397d1dcd047a5c0231e77ca353ebfea306f3";
      const signer = "0x1b978a1d302335a6f2ebe4b8823b5e17c3c84135";
      const multiHashData = await util.signAsync(
        SignAlgorithm.EIP712,
        new Buffer(orderhash.slice(2), "hex"),
        signer,
        privateKey.slice(2));

      console.log("orderhash", orderhash);
      console.log("signer", signer);
      console.log("privateKey", privateKey);
      console.log("multihash", multiHashData);

      const success = await multihash.verifySignature(signer, orderhash, multiHashData);
      assert(success, "Signature should be valid");
    });

    it("should be able to verify signed data", async () => {
      const originsign = "0x01411c65ff9de1f8ffc99a9810933775e096f6b2bf37f9d1a0c8d06193575683080fec035" +
      "6a04e4ba54b60346da4de52722bea63f3415a15b98c3b35d86e2c0d4c7d0b";
      const orderhash = "0xa5040e8f5ea24f4b6c053caaa19c44608e5c33e5f71ad6ee48f97241d597ed3e";
      const privateKey = "0x5b791c6c9f4b7aa95ccb58f0f939397d1dcd047a5c0231e77ca353ebfea306f3";
      const signer = "0x1b978a1d302335a6f2ebe4b8823b5e17c3c84135";
      const multiHashData = await util.signAsync(
        SignAlgorithm.EIP712,
        new Buffer(orderhash.slice(2), "hex"),
        signer,
        privateKey.slice(2));

      console.log("orderhash", orderhash);
      console.log("signer", signer);
      console.log("privateKey", privateKey);
      console.log("multihash", multiHashData);

      const success = await multihash.verifySignature(signer, orderhash, multiHashData);
      assert(success, "Signature should be valid");

      const success2 = await multihash.verifySignature(signer, orderhash, originsign);
      assert(success2, "Signature should be valid");
    });

    it("should be able to verify signed data", async () => {
      const originsign = "0x01411bab20b799087a7d59e9b7c5c7ea73cfaa1ab110ed4e4dc132d73412be91b4e" +
      "4a667c2a5a2a910f1212ef28644a5ed934837c2b77f6767b215191a44f36152bf99";
      const orderhash = "0xbfd908091c41e7dff5e54691d3bae70f783df1a8b9187e85406ec8990942f643";
      const privateKey = "0xba7c9144fe2351c208287f9204b7c5940b0732ac577b771587ea872c4f46da9e";
      const signer = "0xb1018949b241d76a1ab2094f473e9befeabb5ead";
      const multiHashData = await util.signAsync(
        SignAlgorithm.EIP712,
        new Buffer(orderhash.slice(2), "hex"),
        signer,
        privateKey.slice(2));

      console.log("orderhash", orderhash);
      console.log("signer", signer);
      console.log("privateKey", privateKey);
      console.log("multihash", multiHashData);

      const success = await multihash.verifySignature(signer, orderhash, multiHashData);
      assert(success, "Signature should be valid");

      const success2 = await multihash.verifySignature(signer, orderhash, originsign);
      assert(success2, "Signature should be valid");
    });

  });

});
