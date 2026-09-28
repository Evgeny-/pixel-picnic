/** The secret discount belongs to one open shop, never to the saved game. */
export class ShopPurchaseSession {
  private item: string | null = null;
  private attempts = 0;

  constructor(private readonly wallet: { coins: number }) {}

  reset(): void {
    this.item = null;
    this.attempts = 0;
  }

  buy(key: string, price: number, grant: () => void): boolean {
    if (this.wallet.coins < price) {
      if (key !== this.item) {
        this.item = key;
        this.attempts = 0;
      }
      if (++this.attempts < 10) return false;
    } else {
      this.wallet.coins -= price;
    }
    this.reset();
    grant();
    return true;
  }
}
