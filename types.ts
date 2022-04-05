export interface ISale {
    sale_id: string;
    seller: string;
    asset_ids: string[];
    price: {
        amount: string;
        token_precision: number;
        token_contract: string;
        token_symbol: string;
        intended_delphi_median: string;
    },
    listing_price: string;
    settlement_symbol: string;
}

export interface IAtomicMarketConfig {
    version: string;
    sale_counter: number;
    auction_counter: number;
    minimum_bid_increase: number;
    minimum_auction_duration: number;
    maximum_auction_duration: number;
    auction_reset_duration: number;
    supported_tokens: Array<{token_contract: string; token_symbol: string}>;
    supported_symbol_pairs: Array<{
        listing_symbol: string;
        settlement_symbol: string;
        delphi_pair_name: string;
        invert_delphi_pair: boolean;
    }>;
    maker_market_fee: number;
    taker_market_fee: number;
    atomicassets_account: string;
    delphioracle_account: string;
}

export interface IDelphiOracleToken {
    listing_symbol: string;
    settlement_symbol: string;
    delphi_pair_name: string;
    invert_delphi_pair: boolean;
    median_precision: number;
    quote_precision: number;
    base_precision: number;
}
