/* eslint-disable prefer-const */
import { ONE_BD, ZERO_BD, ZERO_BI } from "./constants";
import { Bundle, Pool, Token } from "../generated/schema";
import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import { exponentToBigDecimal, safeDiv } from "./index";
import { createEmptyToken } from "./new";

// prettier-ignore
const WETH_ADDRESS = "0x85119527cf38f6ccf7b1b8f8fad05145358aaa81";
// prettier-ignore
const USDC_WETH_03_POOL = "0xeac8c29642b12231240bbc22004c8182d62d1c1a";

export let WHITELIST_TOKENS: string[] =
  "0x85119527cf38f6ccf7b1b8f8fad05145358aaa81,0x853e38d0b35d2df54d3d91c210b7bd7749d614e8,0x5d2d4baa31e79777383ac407d45495b44d0140b7".split(
    ","
  );

let MINIMUM_ETH_LOCKED = BigDecimal.fromString("0");

let Q192 = BigInt.fromI32(2).pow(192).toBigDecimal();
export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt, token0: Token, token1: Token): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal();
  let price1 = num.div(Q192).times(exponentToBigDecimal(token0.decimals)).div(exponentToBigDecimal(token1.decimals));
  let price0 = safeDiv(BigDecimal.fromString("1"), price1);
  return [price0, price1];
}

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let pool = Pool.load(USDC_WETH_03_POOL); // dai is token0
  if (pool !== null) {
    return pool.token1Price;
  } else {
    return ZERO_BD;
  }
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD;
  }
  let whiteList = token.whitelistPools;
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;
  let bundle = Bundle.load("1");
  if (!bundle) {
    return BigDecimal.fromString("0");
  }

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  for (let i = 0; i < whiteList.length; ++i) {
    let poolAddress = whiteList[i];
    let pool = Pool.load(poolAddress);
    if (!pool) {
      continue;
    }

    if (pool.liquidity.gt(ZERO_BI)) {
      if (pool.token0 == token.id) {
        // whitelist token is token1
        let token1 = Token.load(pool.token1);
        if (!token1) {
          token1 = createEmptyToken(Address.fromString(pool.token1));
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked;
          // token1 per our token * Eth per token1
          priceSoFar = pool.token1Price.times(token1.derivedETH);
        }
      }
      if (pool.token1 == token.id) {
        let token0 = Token.load(pool.token0);
        if (!token0) {
          token0 = createEmptyToken(Address.fromString(pool.token0));
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked;
          // token0 per our token * ETH per token0
          priceSoFar = pool.token0Price.times(token0.derivedETH);
        }
      }
    }
  }
  return priceSoFar; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load("1");
  let price0USD = token0.derivedETH.times(bundle.ethPriceUSD);
  let price1USD = token1.derivedETH.times(bundle.ethPriceUSD);

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD));
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString("2"));
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD;
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountETH(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let derivedETH0 = token0.derivedETH;
  let derivedETH1 = token1.derivedETH;

  // neither token is on white list, tracked amount is 0
  return ZERO_BD;
}

export class AmountType {
  eth: BigDecimal;
  usd: BigDecimal;
  ethUntracked: BigDecimal;
  usdUntracked: BigDecimal;
}

export function getAdjustedAmounts(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): AmountType {
  let derivedETH0 = token0.derivedETH;
  let derivedETH1 = token1.derivedETH;
  let bundle = Bundle.load("1");
  if (!bundle) {
    return {
      eth: BigDecimal.fromString("0"),
      usd: BigDecimal.fromString("0"),
      ethUntracked: BigDecimal.fromString("0"),
      usdUntracked: BigDecimal.fromString("0"),
    };
  }

  let eth = ZERO_BD;
  let ethUntracked = tokenAmount0.times(derivedETH0).plus(tokenAmount1.times(derivedETH1));

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    eth = ethUntracked;
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    eth = tokenAmount0.times(derivedETH0).times(BigDecimal.fromString("2"));
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    eth = tokenAmount1.times(derivedETH1).times(BigDecimal.fromString("2"));
  }

  // Define USD values based on ETH derived values.
  let usd = eth.times(bundle.ethPriceUSD);
  let usdUntracked = ethUntracked.times(bundle.ethPriceUSD);

  return { eth, usd, ethUntracked, usdUntracked };
}
