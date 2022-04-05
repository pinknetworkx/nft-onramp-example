import {Api, JsonRpc} from "eosjs";
import fetch from 'node-fetch';
import {IAtomicMarketConfig, IDelphiOracleToken, ISale} from "./types";
import {JsSignatureProvider} from "eosjs/dist/eosjs-jssig";
import {stringToSymbol} from "eosjs/dist/eosjs-serialize";
import {exactNumberShift, splitEosioToken} from "./utils";

// CONFIG
const RPC_ENDPOINT = 'https://wax.pink.gg'
const MARKET_CONTRACT = 'atomicmarket';
const ALLOWED_SYMBOLS = ['WAX'];

// TODO use private key and proper account permissions
const BUYER_PRIVATE_KEYS: string[] = [];
const BUYER_AUTHORIZATION = {actor: 'account', permission: 'perm'}



// CODE STARTS HERE
const rpc = new JsonRpc(RPC_ENDPOINT, {fetch});
const api = new Api({rpc, signatureProvider: new JsSignatureProvider(BUYER_PRIVATE_KEYS)})

async function getConfig(): Promise<IAtomicMarketConfig> {
    // this fetches the atomicmarket config table from the blockchain to get supported symbols and pairs
    const resp = await rpc.get_table_rows({
        json: true, code: MARKET_CONTRACT, scope: MARKET_CONTRACT, table: 'config', limit: 1
    });

    if (!Array.isArray(resp.rows) || resp.rows.length !== 1) {
        throw new Error('No config found for market contract');
    }

    return resp.rows[0];
}

async function getDelphiPairs(config: IAtomicMarketConfig): Promise<IDelphiOracleToken[]> {
    const result: IDelphiOracleToken[] = [];

    for (const pair of config.supported_symbol_pairs) {
        const resp = await rpc.get_table_rows({
            json: true,
            code: config.delphioracle_account,
            scope: config.delphioracle_account,
            table: 'pairs',
            limit: 1,
            lower_bound: pair.delphi_pair_name,
            upper_bound: pair.delphi_pair_name
        });

        if (!Array.isArray(resp.rows) || resp.rows.length !== 1) {
            throw new Error('Delphi pair not found');
        }

        result.push({
            ...pair,
            median_precision: resp.rows[0].quoted_precision,
            base_precision: stringToSymbol(resp.rows[0].base_symbol).precision,
            quote_precision: stringToSymbol(resp.rows[0].quote_symbol).precision
        });
    }

    return result;
}

async function getSale(config: IAtomicMarketConfig, pairs: IDelphiOracleToken[], saleID: string): Promise<ISale> {
    // This fetches information about the sale from the blockchain
    const sales = await rpc.get_table_rows({
        json: true,
        code: MARKET_CONTRACT,
        scope: MARKET_CONTRACT,
        table: 'sales',
        lower_bound: saleID,
        upper_bound: saleID
    });

    if (!Array.isArray(sales.rows) || sales.rows.length !== 1) {
        throw new Error('Sale not found');
    }

    const sale = sales.rows[0];

    const listingPrice = splitEosioToken(sale.listing_price);
    const settlementSymbol = stringToSymbol(sale.settlement_symbol);

    if (!ALLOWED_SYMBOLS.includes(settlementSymbol.name)) {
        throw new Error('Symbol not supported');
    }

    const token = config.supported_tokens.find(row => stringToSymbol(row.token_symbol).name === settlementSymbol.name);

    if (!token) {
        throw new Error('Symbol not found');
    }

    const price = {
        token_symbol: settlementSymbol.name,
        token_precision: settlementSymbol.precision,
        token_contract: token.token_contract,
        amount: listingPrice.amount,
        intended_delphi_median: '0'
    }

    // When listing symbol is different to settlement symbol we need additional conversion to get the price in the token we want
    if (listingPrice.token_symbol !== settlementSymbol.name) {
        const pair = pairs.find(row =>
            stringToSymbol(row.listing_symbol).name === listingPrice.token_symbol
            && stringToSymbol(row.settlement_symbol).name === settlementSymbol.name
        );

        if (!pair) {
            throw new Error('Symbol pair not supported');
        }

        const datapoints = await rpc.get_table_rows({
            json: true,
            limit: 1,
            code: config.delphioracle_account,
            scope: pair.delphi_pair_name,
            table: 'datapoints',
            index_position: 3,
            key_type: 'i64',
            reverse: true
        });

        if (!Array.isArray(datapoints.rows) || datapoints.rows.length !== 1) {
            throw new Error('No delphi datapoint found');
        }

        if (pair.invert_delphi_pair) {
            price.amount = (+price.amount * datapoints.rows[0].median * Math.pow(10, pair.quote_precision - pair.base_precision - pair.median_precision)).toFixed(0)
        } else {
            price.amount = (+price.amount / datapoints.rows[0].median * Math.pow(10, pair.median_precision + pair.base_precision - pair.quote_precision)).toFixed(0)
        }

        price.intended_delphi_median = String(datapoints.rows[0].median);
    }

    return {
        sale_id: sale.sale_id,
        seller: sale.seller,
        asset_ids: sale.asset_ids,
        price,
        listing_price: sale.listing_price,
        settlement_symbol: sale.settlement_symbol
    }
}

async function purchaseSale(config: IAtomicMarketConfig, sale: ISale, receiver: string): Promise<void> {
    // We only need to send 1 transaction that includes multiple actions
    await api.transact({
        actions: [
            // This is needed to make sure that we are buying the correct listing in case a fork happened when we checked the last time
            {
                account: MARKET_CONTRACT,
                name: 'assertsale',
                authorization: [BUYER_AUTHORIZATION],
                data: {
                    sale_id: sale.sale_id,
                    asset_ids_to_assert: sale.asset_ids,
                    listing_price_to_assert: sale.listing_price,
                    settlement_symbol_to_assert: sale.settlement_symbol
                }
            },
            // Here we deposit the tokens to the smart contract we need for the purchase
            {
                account: sale.price.token_contract,
                name: 'transfer',
                authorization: [BUYER_AUTHORIZATION],
                data: {
                    from: BUYER_AUTHORIZATION.actor,
                    to: MARKET_CONTRACT,
                    quantity: `${exactNumberShift(sale.price.amount, sale.price.token_precision)} ${sale.price.token_symbol}`,
                    memo: 'deposit'
                }
            },
            // Here we purchase the NFT, so we have it in the buyer account
            {
                account: MARKET_CONTRACT,
                name: 'purchasesale',
                authorization: [BUYER_AUTHORIZATION],
                data: {
                    buyer: BUYER_AUTHORIZATION.actor,
                    sale_id: sale.sale_id,
                    intended_delphi_median: sale.price.intended_delphi_median,
                    taker_marketplace: '.'
                }
            },
            // Here we transfer the NFTs to the real buyer in the same transaction
            {
                account: config.atomicassets_account,
                name: 'transfer',
                authorization: [BUYER_AUTHORIZATION],
                data: {
                    from: BUYER_AUTHORIZATION.actor,
                    to: receiver,
                    asset_ids: sale.asset_ids,
                    memo: `AtomicMarket Purchased Sale - ID # ${sale.sale_id}`
                }
            }
        ]
    }, {useLastIrreversible: true, expireSeconds: 30});
}

// EXAMPLE
(async () => {
    // This is the user that is buying with a credit card
    const user = 'testbuyer';

    // the getConfig() and getDelphiPairs() result can be cached and reused between purchases
    const config = await getConfig();
    const pairs = await getDelphiPairs(config);
    // this get details about a sale by sale_id
    const sale = await getSale(config, pairs, '68987754');
    console.log('sale', sale);

    // TODO Buy required token amount to execute purchase
    console.log('----------------')
    console.log(`${user} needs to buy ${exactNumberShift(sale.price.amount, sale.price.token_precision)} ${sale.price.token_symbol}`)
    console.log('----------------')

    // execute purchase when payment was successful
    await purchaseSale(config, sale, user);
})();
