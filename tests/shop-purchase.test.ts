import { describe, expect, it, vi } from 'vitest';
import { ShopPurchaseSession } from '../src/ui/ShopPurchaseSession';

describe('shop secret discount', () => {
  it.each([0, 37, 1499])('grants an unaffordable item on exactly the tenth click with %i coins', (coins) => {
    const wallet = { coins };
    const shop = new ShopPurchaseSession(wallet);
    const grant = vi.fn();
    for (let click = 1; click < 10; click++) {
      expect(shop.buy('hat:crown', 1500, grant)).toBe(false);
      expect(wallet.coins).toBe(coins);
      expect(grant).not.toHaveBeenCalled();
    }
    expect(shop.buy('hat:crown', 1500, grant)).toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(wallet.coins).toBe(coins);
  });

  it('starts over when another item is clicked', () => {
    const shop = new ShopPurchaseSession({ coins: 0 });
    const grant = vi.fn();
    for (let click = 0; click < 9; click++) shop.buy('house:basket', 500, grant);
    expect(shop.buy('box:basket', 500, grant)).toBe(false);
    for (let click = 0; click < 9; click++) expect(shop.buy('house:basket', 500, grant)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
    expect(shop.buy('house:basket', 500, grant)).toBe(true);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('forgets the streak when selecting an owned item or changing tabs', () => {
    const shop = new ShopPurchaseSession({ coins: 0 });
    const grant = vi.fn();
    for (let click = 0; click < 9; click++) shop.buy('creature:human', 3000, grant);
    shop.reset();
    expect(shop.buy('creature:human', 3000, grant)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
  });

  it('does not retain clicks when the shop is reopened', () => {
    const wallet = { coins: 50 };
    const grant = vi.fn();
    const firstVisit = new ShopPurchaseSession(wallet);
    for (let click = 0; click < 9; click++) firstVisit.buy('creature:human', 3000, grant);
    const nextVisit = new ShopPurchaseSession(wallet);
    expect(nextVisit.buy('creature:human', 3000, grant)).toBe(false);
    expect(grant).not.toHaveBeenCalled();
    expect(wallet.coins).toBe(50);
  });

  it('uses the regular price whenever the player has enough coins and clears the streak', () => {
    const wallet = { coins: 20 };
    const shop = new ShopPurchaseSession(wallet);
    const grant = vi.fn();
    for (let click = 0; click < 9; click++) shop.buy('booster:hint', 60, grant);
    wallet.coins = 60;
    expect(shop.buy('booster:hint', 60, grant)).toBe(true);
    expect(wallet.coins).toBe(0);
    expect(grant).toHaveBeenCalledTimes(1);
    expect(shop.buy('booster:hint', 60, grant)).toBe(false);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('grants only one consumable for each full ten-click streak', () => {
    const wallet = { coins: 1 };
    const shop = new ShopPurchaseSession(wallet);
    let boosters = 0;
    const grant = () => { boosters++; };
    for (let click = 1; click <= 20; click++) {
      expect(shop.buy('booster:hint', 60, grant)).toBe(click % 10 === 0);
      expect(boosters).toBe(Math.floor(click / 10));
      expect(wallet.coins).toBe(1);
    }
  });
});
