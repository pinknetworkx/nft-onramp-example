export function splitEosioToken(asset: string): {token_symbol: string, token_precision: number, amount: string}  {
    const split1 = asset.split(' ');
    const split2 = split1[0].split('.');

    return {
        amount: split2.join(''),
        token_symbol: split1[1],
        token_precision: split2[1] ? split2[1].length : 0,
    };
}

export function exactNumberShift(amount: string, precision: number): string {
    let n = '0'.repeat(precision) + amount;

    n = `${n.substr(0, n.length - precision)}.${n.substr(n.length - precision)}`;

    while (n[0] === '0' && n.length > precision + 2) {
        n = n.substr(1);
    }

    return n;
}
