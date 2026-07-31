const notifier = require('node-notifier');

/**
 * Fires a Windows toast for a stock transition. Clicking it opens the listing URL.
 * Only called for transitions the server actually pushed — see index.js's price gate.
 */
function notifyStockIn({ productName, store, pincode, url, price }) {
  const storeName = store.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const priceText = price != null ? ` for ₹${Number(price).toLocaleString('en-IN')}` : ' (price unknown)';
  notifier.notify(
    {
      title: 'PS5 in stock!',
      message: `${productName || 'PS5 listing'}${priceText} is deliverable to ${pincode} on ${storeName}`,
      sound: true,
      wait: true,
    },
    (err, response, metadata) => {
      if (!err && (response === 'activate' || metadata?.activationType === 'clicked') && url) {
        require('child_process').exec(`start "" "${url}"`);
      }
    }
  );
}

module.exports = { notifyStockIn };
