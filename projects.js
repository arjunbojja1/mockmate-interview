// Multi-file projects with a test suite, for Backend interviews (kind
// 'backend': build a feature from a spec) and Debugging interviews (kind
// 'debugging': find and fix the bugs). Run executes the entry file; Run tests runs
// every test file (Python: unittest or plain test_ functions; JavaScript:
// node:test and node:assert). Files marked hidden are never sent to the
// candidate but are part of every run, so they work as hidden tests.
// Each project's bugs and its fixed version were checked against its tests.
window.ONSITE_PROJECTS = [
  {
    id: 'checkout-service',
    kind: 'debugging',
    title: 'Checkout service',
    difficulty: 'medium',
    lang: 'python',
    topics: 'Bug squash · Python',
    entry: 'main.py',
    prompt: `Customers are reporting wrong order totals, and stock counts that drift after failed checkouts. Find and fix the bugs.

The code
• catalog.py: products and prices (integer cents)
• cart.py: the shopping cart
• discounts.py: coupon codes
• checkout.py: reserves stock and computes the order total
• main.py: checks out one cart (Run executes it)
• test_*.py: the test suite (Run tests)

How it should behave
• Removing a product's last unit, or more units than are in the cart, takes it out of the cart.
• Coupon codes are case-insensitive. A coupon never discounts more than the subtotal.
• Tax is 8% of the subtotal after the discount, rounded down to the cent.
• Checkout is all-or-nothing: if any product is short on stock, nothing is reserved.

Run the code and the tests, then fix the bugs one at a time. Talk through how you narrow each one down.`,
    solution: `Five bugs, roughly in the order people find them:
1. discounts.py: COUPONS.get(code) is case-sensitive, so main.py crashes on "save10". Fix: code.strip().upper().
2. checkout.py: tax is taken on the subtotal. Fix: (subtotal - discount) * 8 // 100.
3. cart.py: remove() leaves a 0 or negative line, so is_empty() is wrong. Delete the line at <= 0.
4. discounts.py (hidden test): FIVEOFF on a $4.99 cart makes the total negative. Fix: min(value, subtotal).
5. checkout.py (hidden test): stock is decremented while later lines are still being checked, so a failed checkout leaves partial reservations. Check every line first, then decrement.
Signals: reproduces before fixing, reads the failing assertion rather than guessing, adds a test for the partial-reservation bug unprompted.
Follow-ups: two checkouts racing for the last unit (locking, compare-and-set, DB constraints); idempotency keys for retried checkouts.`,
    files: [
      { name: 'main.py', content: `from cart import Cart
from checkout import checkout

inventory = {"MUG": 10, "TEE": 3, "CAP": 0, "STICKER": 50}

cart = Cart()
cart.add("MUG", 2)
cart.add("TEE")
cart.add("STICKER", 3)
cart.remove("STICKER", 3)

order = checkout(cart, inventory, coupon="save10")
print("Order:", order)
print("Stock left:", inventory)
` },
      { name: 'cart.py', content: `from catalog import price_of


class Cart:
    def __init__(self):
        self.lines = {}  # sku -> quantity

    def add(self, sku, qty=1):
        if qty <= 0:
            raise ValueError("quantity must be positive")
        price_of(sku)  # rejects unknown products
        self.lines[sku] = self.lines.get(sku, 0) + qty

    def remove(self, sku, qty=1):
        if sku not in self.lines:
            raise KeyError(sku)
        self.lines[sku] -= qty

    def is_empty(self):
        return not self.lines

    def subtotal(self):
        return sum(price_of(sku) * qty for sku, qty in self.lines.items())
` },
      { name: 'checkout.py', content: `from discounts import discount_for

TAX_RATE_PERCENT = 8


class OutOfStock(Exception):
    pass


def checkout(cart, inventory, coupon=None):
    """Reserve stock for the whole cart and return the order totals.

    inventory maps sku -> units in stock and is updated in place.
    """
    if cart.is_empty():
        raise ValueError("cart is empty")

    for sku, qty in cart.lines.items():
        if inventory.get(sku, 0) < qty:
            raise OutOfStock(sku)
        inventory[sku] -= qty

    subtotal = cart.subtotal()
    discount = discount_for(subtotal, coupon)
    tax = subtotal * TAX_RATE_PERCENT // 100
    total = subtotal - discount + tax
    return {"subtotal": subtotal, "discount": discount, "tax": tax, "total": total}
` },
      { name: 'discounts.py', content: `COUPONS = {
    "SAVE10": {"type": "percent", "value": 10},
    "SAVE25": {"type": "percent", "value": 25},
    "FIVEOFF": {"type": "fixed", "value": 500},
}


def discount_for(subtotal, code):
    """Discount in cents for a coupon code. Codes are case-insensitive."""
    if not code:
        return 0
    coupon = COUPONS.get(code)
    if coupon is None:
        raise ValueError(f"invalid coupon: {code}")
    if coupon["type"] == "percent":
        return subtotal * coupon["value"] // 100
    return coupon["value"]
` },
      { name: 'catalog.py', content: `"""Product catalog. All prices are integer cents."""

PRODUCTS = {
    "MUG": {"name": "Coffee mug", "price": 1299},
    "TEE": {"name": "T-shirt", "price": 2000},
    "CAP": {"name": "Baseball cap", "price": 1550},
    "STICKER": {"name": "Sticker pack", "price": 499},
}


def price_of(sku):
    try:
        return PRODUCTS[sku]["price"]
    except KeyError:
        raise ValueError(f"unknown product: {sku}") from None
` },
      { name: 'test_cart.py', content: `import unittest

from cart import Cart


class CartTest(unittest.TestCase):
    def test_subtotal_sums_every_line(self):
        cart = Cart()
        cart.add("MUG", 2)
        cart.add("STICKER")
        self.assertEqual(cart.subtotal(), 2 * 1299 + 499)

    def test_adding_the_same_product_accumulates(self):
        cart = Cart()
        cart.add("TEE")
        cart.add("TEE", 2)
        self.assertEqual(cart.lines, {"TEE": 3})

    def test_removing_every_unit_empties_the_cart(self):
        cart = Cart()
        cart.add("CAP", 2)
        cart.remove("CAP", 2)
        self.assertTrue(cart.is_empty())

    def test_unknown_products_are_rejected(self):
        with self.assertRaises(ValueError):
            Cart().add("BOGUS")
` },
      { name: 'test_checkout.py', content: `import unittest

from cart import Cart
from checkout import OutOfStock, checkout


def make_cart(**lines):
    cart = Cart()
    for sku, qty in lines.items():
        cart.add(sku, qty)
    return cart


class CheckoutTest(unittest.TestCase):
    def test_totals_without_a_coupon(self):
        order = checkout(make_cart(TEE=2), {"TEE": 5})
        self.assertEqual(order, {"subtotal": 4000, "discount": 0, "tax": 320, "total": 4320})

    def test_reserves_stock(self):
        inventory = {"MUG": 5}
        checkout(make_cart(MUG=2), inventory)
        self.assertEqual(inventory["MUG"], 3)

    def test_out_of_stock(self):
        with self.assertRaises(OutOfStock):
            checkout(make_cart(TEE=4), {"TEE": 3})

    def test_coupon_codes_are_case_insensitive(self):
        order = checkout(make_cart(TEE=1), {"TEE": 1}, coupon="save10")
        self.assertEqual(order["discount"], 200)

    def test_tax_applies_after_the_discount(self):
        order = checkout(make_cart(TEE=2), {"TEE": 2}, coupon="SAVE25")
        # (4000 - 1000) * 8% = 240
        self.assertEqual(order["tax"], 240)
        self.assertEqual(order["total"], 3240)
` },
      { name: 'test_checkout_hidden.py', hidden: true, content: `import unittest

from cart import Cart
from checkout import OutOfStock, checkout


class CheckoutEdgeCases(unittest.TestCase):
    def test_failed_checkout_reserves_nothing(self):
        cart = Cart()
        cart.add("MUG", 1)
        cart.add("TEE", 5)
        inventory = {"MUG": 3, "TEE": 1}
        with self.assertRaises(OutOfStock):
            checkout(cart, inventory)
        self.assertEqual(inventory, {"MUG": 3, "TEE": 1})

    def test_fixed_coupon_never_goes_below_zero(self):
        cart = Cart()
        cart.add("STICKER")
        order = checkout(cart, {"STICKER": 1}, coupon="FIVEOFF")
        self.assertEqual(order["discount"], 499)
        self.assertEqual(order["total"], 0)

    def test_removing_more_than_is_in_the_cart(self):
        cart = Cart()
        cart.add("MUG")
        cart.add("CAP")
        cart.remove("MUG", 3)
        self.assertEqual(cart.lines, {"CAP": 1})

    def test_cart_emptied_by_removal_cannot_check_out(self):
        cart = Cart()
        cart.add("MUG")
        cart.remove("MUG")
        with self.assertRaises(ValueError):
            checkout(cart, {"MUG": 1})
` },
    ],
  },
  {
    id: 'rate-limiter',
    kind: 'debugging',
    title: 'API rate limiter',
    difficulty: 'medium',
    lang: 'python',
    topics: 'Bug squash · Python',
    entry: 'main.py',
    prompt: `Our API's rate limiter is misbehaving: some clients stay blocked long after they should recover, and the Retry-After header is wrong. Find and fix the bugs.

The code
• limiter.py: a sliding-window limiter (at most limit requests per client in any window seconds)
• middleware.py: wraps a request handler and returns 429 when a client is over the limit
• clock.py: a real clock, and a FakeClock tests can move by hand
• main.py: sends a burst of requests (Run executes it)
• test_*.py: the test suite (Run tests)

How it should behave
• A request made exactly window seconds ago no longer counts.
• Rejected requests don't count against the limit.
• Each limiter has its own state.
• Retry-After is the time until the client's oldest counted request leaves the window, in whole seconds, rounded up.

Start with main.py's output: what do you expect at t=11, and what happens?`,
    solution: `Five bugs:
1. limiter.py: _requests is a class attribute, so every limiter shares one dict (hidden test). Move it into __init__.
2. limiter.py: _prune uses > window; a request exactly window old should expire. Use >=.
3. limiter.py: allow() appends before checking, so rejected requests count and a client that keeps retrying is locked out forever. Check len >= limit first; only append when allowing.
4. limiter.py: retry_after uses the newest timestamp (timestamps[-1]); it should use the oldest (timestamps[0]).
5. middleware.py: Retry-After is str() of a float ("45.0"). Use math.ceil (hidden test covers 7.5 -> "8").
Signals: notices the class attribute (often only after the hidden test fails, or when tests behave differently in isolation), reasons about boundaries with the fake clock rather than sleeping.
Follow-ups: memory growth with many clients (evict idle keys), sharing limits across processes (Redis sorted set or token bucket with Lua), fixed window vs sliding log vs token bucket trade-offs.`,
    files: [
      { name: 'main.py', content: `from clock import FakeClock
from limiter import SlidingWindowLimiter
from middleware import rate_limited


def hello(request):
    return {"status": 200, "body": "hello"}


clock = FakeClock()
api = rate_limited(SlidingWindowLimiter(limit=3, window=10, clock=clock), hello)

for i in range(5):
    response = api({"ip": "10.0.0.1"})
    print(f"t={clock.now():>4}  request {i + 1}: {response['status']}", response.get("headers", ""))
    clock.advance(1)

clock.advance(6)  # t=11: the first two requests are now outside the window
print(f"t={clock.now():>4}  after waiting:", api({"ip": "10.0.0.1"}))
` },
      { name: 'limiter.py', content: `from collections import deque


class SlidingWindowLimiter:
    """Allow at most \`limit\` requests per client in any \`window\` seconds.

    A request made exactly \`window\` seconds ago no longer counts.
    """

    _requests = {}  # client id -> deque of request timestamps, oldest first

    def __init__(self, limit, window, clock):
        self.limit = limit
        self.window = window
        self.clock = clock

    def _prune(self, timestamps, now):
        while timestamps and now - timestamps[0] > self.window:
            timestamps.popleft()

    def allow(self, client_id):
        now = self.clock.now()
        timestamps = self._requests.setdefault(client_id, deque())
        self._prune(timestamps, now)
        timestamps.append(now)
        return len(timestamps) <= self.limit

    def retry_after(self, client_id):
        """Seconds until this client can make another request (0 if it can now)."""
        now = self.clock.now()
        timestamps = self._requests.get(client_id, deque())
        self._prune(timestamps, now)
        if len(timestamps) < self.limit:
            return 0
        return self.window - (now - timestamps[-1])
` },
      { name: 'middleware.py', content: `def rate_limited(limiter, handler):
    """Wrap handler(request) -> response with per-client rate limiting.

    Clients are identified by their API key, or by IP if they have none.
    Rejected requests get a 429 with Retry-After in whole seconds.
    """

    def wrapped(request):
        client = request.get("api_key") or request["ip"]
        if not limiter.allow(client):
            return {
                "status": 429,
                "headers": {"Retry-After": str(limiter.retry_after(client))},
                "body": "Too Many Requests",
            }
        return handler(request)

    return wrapped
` },
      { name: 'clock.py', content: `import time


class SystemClock:
    def now(self):
        return time.monotonic()


class FakeClock:
    """A clock that only moves when a test tells it to."""

    def __init__(self, start=0.0):
        self.t = start

    def now(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds
` },
      { name: 'test_limiter.py', content: `import unittest

from clock import FakeClock
from limiter import SlidingWindowLimiter


class LimiterTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.limiter = SlidingWindowLimiter(limit=2, window=10, clock=self.clock)

    def test_allows_up_to_the_limit(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("alice"))

    def test_clients_are_limited_separately(self):
        self.limiter.allow("alice")
        self.limiter.allow("alice")
        self.assertTrue(self.limiter.allow("bob"))

    def test_requests_expire_after_the_window(self):
        self.limiter.allow("carol")
        self.limiter.allow("carol")
        self.clock.advance(10)
        self.assertTrue(self.limiter.allow("carol"))

    def test_rejected_requests_do_not_count(self):
        for _ in range(5):
            self.limiter.allow("dave")
        self.clock.advance(10)
        self.assertTrue(self.limiter.allow("dave"))
        self.assertTrue(self.limiter.allow("dave"))
` },
      { name: 'test_middleware.py', content: `import unittest

from clock import FakeClock
from limiter import SlidingWindowLimiter
from middleware import rate_limited


def ok(request):
    return {"status": 200, "body": "ok"}


class MiddlewareTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.api = rate_limited(SlidingWindowLimiter(limit=2, window=60, clock=self.clock), ok)

    def test_passes_requests_under_the_limit(self):
        self.assertEqual(self.api({"ip": "1.1.1.1"})["status"], 200)

    def test_returns_429_over_the_limit(self):
        self.api({"ip": "2.2.2.2"})
        self.api({"ip": "2.2.2.2"})
        self.assertEqual(self.api({"ip": "2.2.2.2"})["status"], 429)

    def test_retry_after_counts_from_the_oldest_request(self):
        self.api({"ip": "3.3.3.3"})
        self.clock.advance(5)
        self.api({"ip": "3.3.3.3"})
        self.clock.advance(10)
        response = self.api({"ip": "3.3.3.3"})
        # The oldest request (t=0) leaves the window at t=60.
        self.assertEqual(response["headers"]["Retry-After"], "45")
` },
      { name: 'test_limiter_hidden.py', hidden: true, content: `import unittest

from clock import FakeClock
from limiter import SlidingWindowLimiter
from middleware import rate_limited


class HiddenLimiterTest(unittest.TestCase):
    def test_two_limiters_do_not_share_state(self):
        clock = FakeClock()
        strict = SlidingWindowLimiter(limit=1, window=10, clock=clock)
        other = SlidingWindowLimiter(limit=1, window=10, clock=clock)
        self.assertTrue(strict.allow("same-client"))
        self.assertTrue(other.allow("same-client"))

    def test_retry_after_rounds_up_to_whole_seconds(self):
        clock = FakeClock()
        api = rate_limited(SlidingWindowLimiter(limit=1, window=10, clock=clock), lambda r: {"status": 200})
        api({"ip": "9.9.9.9"})
        clock.advance(2.5)
        self.assertEqual(api({"ip": "9.9.9.9"})["headers"]["Retry-After"], "8")

    def test_api_key_and_ip_are_separate_clients(self):
        clock = FakeClock()
        api = rate_limited(SlidingWindowLimiter(limit=1, window=10, clock=clock), lambda r: {"status": 200})
        api({"ip": "8.8.8.8", "api_key": "k1"})
        self.assertEqual(api({"ip": "8.8.8.8"})["status"], 200)

    def test_retry_after_is_zero_for_a_new_client(self):
        limiter = SlidingWindowLimiter(limit=1, window=10, clock=FakeClock())
        self.assertEqual(limiter.retry_after("nobody-yet"), 0)
` },
    ],
  },
  {
    id: 'users-api',
    kind: 'debugging',
    title: 'Users API: routing and pagination',
    difficulty: 'medium',
    lang: 'javascript',
    topics: 'Bug squash, then validation · JavaScript',
    entry: 'index.js',
    prompt: `A small JSON API over an in-memory database. Almost every endpoint returns the wrong thing. Find and fix the bugs, then add input validation.

The code
• src/router.js: matches METHOD + path patterns like /users/:id
• src/handlers.js: the endpoint handlers
• src/paginate.js: page-number pagination
• src/db.js: the in-memory data
• index.js: sends a few requests (Run executes it)
• test/*.test.js: the test suite, using node:test and node:assert (Run tests)

Endpoints
• GET /users?page=&pageSize= lists active users. Pages start at 1; pageSize defaults to 10.
• GET /users/:id returns one user, or 404.
• GET /users/:id/orders returns that user's orders, or 404.
• Anything else is a 404.

Then add
• page and pageSize must be positive integers, or the response is a 400.
• pageSize is capped at 50.
• The response's page and pageSize are numbers.`,
    solution: `Bugs:
1. router.js: the pattern regex isn't anchored with $, so "/users" (registered first) matches every /users/... path. Every request hits listUsers.
2. handlers.js getUser: params.id is a string and db.findUser compares with ===. Convert with Number().
3. paginate.js: start = page * pageSize skips the first page. Use (page - 1) * pageSize.
4. paginate.js: totalPages uses Math.floor. Use Math.ceil.
5. handlers.js listUsers: query values are strings, so start + pageSize concatenates ("5" + "5" = "55"). Convert to numbers.
Feature (hidden tests): reject non-integer or < 1 page/pageSize with 400, cap pageSize at 50.
Signals: finds the router bug from index.js output before reading every file; checks types at the boundary instead of sprinkling Number() everywhere.
Follow-ups: cursor vs offset pagination when rows are inserted mid-scroll; route precedence and trailing slashes; URL-decoding params.`,
    files: [
      { name: 'index.js', content: `const { createApp } = require('./src/app');

const app = createApp();
const requests = [
  { method: 'GET', url: '/users?page=1&pageSize=5' },
  { method: 'GET', url: '/users/3' },
  { method: 'GET', url: '/users/1/orders' },
  { method: 'GET', url: '/users/999' },
];

for (const req of requests) {
  const res = app.handle(req);
  console.log(req.method, req.url, '->', res.status, JSON.stringify(res.body));
}
` },
      { name: 'src/app.js', content: `const { Router } = require('./router');
const handlers = require('./handlers');

function createApp() {
  const router = new Router();
  router.add('GET', '/users', handlers.listUsers);
  router.add('GET', '/users/:id', handlers.getUser);
  router.add('GET', '/users/:id/orders', handlers.getUserOrders);
  return router;
}

module.exports = { createApp };
` },
      { name: 'src/router.js', content: `// A tiny router: register a handler for a method and a path pattern like
// "/users/:id", then dispatch requests shaped like { method, url }.
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const names = [];
    const source = pattern.replace(/:(\\w+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
    this.routes.push({ method, regex: new RegExp('^' + source), names, handler });
  }

  handle(req) {
    const [path, queryString = ''] = req.url.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString));
    for (const route of this.routes) {
      const match = route.regex.exec(path);
      if (!match || route.method !== req.method) continue;
      const params = {};
      route.names.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      return route.handler({ ...req, path, params, query });
    }
    return { status: 404, body: { error: 'not found' } };
  }
}

module.exports = { Router };
` },
      { name: 'src/handlers.js', content: `const db = require('./db');
const { paginate } = require('./paginate');

// GET /users?page=&pageSize= : active users only
function listUsers({ query }) {
  const active = db.listUsers().filter(u => u.active);
  const page = query.page || 1;
  const pageSize = query.pageSize || 10;
  return { status: 200, body: paginate(active, page, pageSize) };
}

// GET /users/:id
function getUser({ params }) {
  const user = db.findUser(params.id);
  if (!user) return { status: 404, body: { error: 'user not found' } };
  return { status: 200, body: user };
}

// GET /users/:id/orders
function getUserOrders({ params }) {
  const user = db.findUser(Number(params.id));
  if (!user) return { status: 404, body: { error: 'user not found' } };
  return { status: 200, body: db.ordersFor(user.id) };
}

module.exports = { listUsers, getUser, getUserOrders };
` },
      { name: 'src/paginate.js', content: `// Page-number pagination. Pages are numbered from 1.
function paginate(items, page = 1, pageSize = 10) {
  const start = page * pageSize;
  const end = start + pageSize;
  return {
    items: items.slice(start, end),
    page,
    pageSize,
    totalPages: Math.floor(items.length / pageSize),
  };
}

module.exports = { paginate };
` },
      { name: 'src/db.js', content: `// In-memory stand-in for the database. Every 4th user is deactivated.
const users = [];
for (let id = 1; id <= 23; id++) {
  users.push({ id, name: 'User ' + id, active: id % 4 !== 0 });
}

const orders = [
  { id: 101, userId: 1, total: 2599 },
  { id: 102, userId: 1, total: 1250 },
  { id: 103, userId: 3, total: 999 },
];

module.exports = {
  listUsers: () => users,
  findUser: id => users.find(u => u.id === id),
  ordersFor: userId => orders.filter(o => o.userId === userId),
};
` },
      { name: 'test/users.test.js', content: `const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

const app = createApp();
const get = url => app.handle({ method: 'GET', url });

test('GET /users/:id returns the user', () => {
  const res = get('/users/3');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { id: 3, name: 'User 3', active: true });
});

test('GET /users/:id is a 404 for an unknown user', () => {
  assert.strictEqual(get('/users/999').status, 404);
});

test("GET /users/:id/orders lists that user's orders", () => {
  const res = get('/users/1/orders');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.map(o => o.id), [101, 102]);
});

test('unknown routes are a 404', () => {
  assert.strictEqual(get('/nope').status, 404);
});
` },
      { name: 'test/pagination.test.js', content: `const { describe, it } = require('node:test');
const assert = require('node:assert');
const { paginate } = require('../src/paginate');
const { createApp } = require('../src/app');

const numbers = Array.from({ length: 23 }, (_, i) => i + 1);

describe('paginate', () => {
  it('returns the first page', () => {
    assert.deepStrictEqual(paginate(numbers, 1, 10).items, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('counts a partial last page', () => {
    assert.strictEqual(paginate(numbers, 1, 10).totalPages, 3);
  });
});

describe('GET /users', () => {
  const app = createApp();

  it('lists active users, 10 per page by default', () => {
    const res = app.handle({ method: 'GET', url: '/users' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.items.length, 10);
    assert.ok(res.body.items.every(u => u.active));
  });

  it('reads page and pageSize from the query string', () => {
    const res = app.handle({ method: 'GET', url: '/users?page=2&pageSize=5' });
    assert.deepStrictEqual(res.body.items.map(u => u.id), [7, 9, 10, 11, 13]);
  });
});
` },
      { name: 'test/edge-cases.test.js', hidden: true, content: `const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

const app = createApp();
const get = url => app.handle({ method: 'GET', url });

test('the last page is partial', () => {
  const res = get('/users?page=4&pageSize=5');
  assert.deepStrictEqual(res.body.items.map(u => u.id), [21, 22, 23]);
  assert.strictEqual(res.body.totalPages, 4);
});

test('a page past the end is empty, not an error', () => {
  const res = get('/users?page=9');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.items, []);
});

test('page and pageSize come back as numbers', () => {
  const res = get('/users?page=2&pageSize=3');
  assert.strictEqual(res.body.page, 2);
  assert.strictEqual(res.body.pageSize, 3);
});

test('invalid page or pageSize is a 400', () => {
  for (const qs of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=-3']) {
    assert.strictEqual(get('/users?' + qs).status, 400, qs);
  }
});

test('pageSize is capped at 50', () => {
  assert.strictEqual(get('/users?pageSize=500').body.pageSize, 50);
});

test('extra path segments do not match a route', () => {
  assert.strictEqual(get('/users/1/orders/extra').status, 404);
});
` },
    ],
  },
  {
    id: 'url-shortener',
    kind: 'backend',
    title: 'URL shortener API',
    difficulty: 'medium',
    lang: 'python',
    topics: 'REST endpoints · Python',
    entry: 'main.py',
    prompt: `Build the three endpoints of a URL shortener. The routing, storage, and code generation are done; the handlers in handlers.py are yours.

The code
• handlers.py: the three handlers to implement
• app.py: routes requests to the handlers (a response is {"status", "headers", "body"})
• store.py: in-memory LinkStore, with next_number() for generating codes
• codes.py: encode(n) turns a number into a short base-62 code
• main.py: makes a few requests (Run executes it)
• test_*.py: the test suite (Run tests)

POST /links  body {"url": ..., "alias": optional}
• 201 with {"code", "short_url"}; short_url is "https://sho.rt/" + code.
• The url must be http or https and have a host, otherwise 400.
• An alias is 3 to 30 letters, digits, "-" or "_", otherwise 400. A taken alias is a 409.
• Without an alias, a code comes from encode(store.next_number()). Shortening a URL that already has a generated code returns that code with a 200.

GET /<code>
• 302 with a Location header pointing at the URL, and counts a click. Unknown codes are a 404.

GET /links/<code>/stats
• 200 with {"url", "clicks"}, or 404.`,
    solution: `Look for: validation at the edge, the right status codes, and spotting the collision case.
• URL check: urllib.parse.urlparse, scheme in (http, https) and a non-empty netloc. "https://" alone has no host.
• Alias: regex ^[A-Za-z0-9_-]{3,30}$. Hidden test expects "links" to be rejected (it would shadow /links/...); good to ask whether they'd reserve route names.
• Generated codes can collide with an alias someone already chose (hidden test aliases encode(100000), the first generated code). Loop on next_number() until the code is free.
• Same URL twice: the hidden test expects the existing code with 200. Linear scan is fine here; ask what index they'd add at scale (url -> code).
• Stats must not count as a click.
Follow-ups: storage and code generation across many servers (ID ranges, random codes with retry), caching redirects, 301 vs 302 and what it does to click counts, abuse (rate limits, malicious URLs).`,
    files: [
      { name: 'handlers.py', content: `"""Request handlers for the URL shortener. Implement these three.

Each one gets the LinkStore, the request body (a dict), and any path
parameters, and returns {"status": int, "headers": dict, "body": ...}.
The question describes exactly how each endpoint should behave.
"""

from codes import encode

SHORT_DOMAIN = "https://sho.rt/"


def create_link(store, body):
    """POST /links  body: {"url": "...", "alias": "optional"}"""
    raise NotImplementedError


def follow_link(store, body, code):
    """GET /<code>"""
    raise NotImplementedError


def link_stats(store, body, code):
    """GET /links/<code>/stats"""
    raise NotImplementedError
` },
      { name: 'app.py', content: `import re

import handlers
from store import LinkStore

ROUTES = [
    ("POST", re.compile(r"^/links$"), handlers.create_link),
    ("GET", re.compile(r"^/links/(?P<code>[^/]+)/stats$"), handlers.link_stats),
    ("GET", re.compile(r"^/(?P<code>[^/]+)$"), handlers.follow_link),
]


class App:
    """Sends each request to its handler.

    A response is a dict: {"status": int, "headers": dict, "body": anything}.
    """

    def __init__(self, store=None):
        self.store = store or LinkStore()

    def request(self, method, path, body=None):
        for route_method, pattern, handler in ROUTES:
            match = pattern.match(path)
            if match and route_method == method:
                return handler(self.store, body or {}, **match.groupdict())
        return {"status": 404, "headers": {}, "body": {"error": "not found"}}
` },
      { name: 'store.py', content: `class LinkStore:
    """In-memory storage for short links."""

    def __init__(self):
        self.links = {}  # code -> {"url": str, "clicks": int}
        self._next_number = 100_000

    def get(self, code):
        return self.links.get(code)

    def put(self, code, url):
        self.links[code] = {"url": url, "clicks": 0}

    def next_number(self):
        """A new number for generating a code. Never returns the same one twice."""
        n = self._next_number
        self._next_number += 1
        return n
` },
      { name: 'codes.py', content: `ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"


def encode(n):
    """Base-62 encode a non-negative integer: encode(100000) == "q0U"."""
    if n == 0:
        return ALPHABET[0]
    out = []
    while n:
        n, r = divmod(n, 62)
        out.append(ALPHABET[r])
    return "".join(reversed(out))
` },
      { name: 'main.py', content: `from app import App

app = App()

created = app.request("POST", "/links", {"url": "https://example.com/a/very/long/path"})
print("create:", created)

code = created["body"]["code"]
print("follow:", app.request("GET", "/" + code))
print("stats: ", app.request("GET", f"/links/{code}/stats"))
print("alias: ", app.request("POST", "/links", {"url": "https://onsite.dev", "alias": "onsite"}))
` },
      { name: 'test_links.py', content: `import unittest

from app import App


class CreateLinkTest(unittest.TestCase):
    def setUp(self):
        self.app = App()

    def create(self, body):
        return self.app.request("POST", "/links", body)

    def test_creates_a_short_link(self):
        res = self.create({"url": "https://example.com/page"})
        self.assertEqual(res["status"], 201)
        code = res["body"]["code"]
        self.assertEqual(res["body"]["short_url"], "https://sho.rt/" + code)

    def test_rejects_urls_that_are_not_http(self):
        for url in ["example.com", "ftp://example.com/file", "", "https://"]:
            self.assertEqual(self.create({"url": url})["status"], 400, url)

    def test_custom_alias(self):
        res = self.create({"url": "https://example.com", "alias": "my-link"})
        self.assertEqual(res["status"], 201)
        self.assertEqual(res["body"]["code"], "my-link")

    def test_taken_alias_is_a_conflict(self):
        self.create({"url": "https://a.com", "alias": "taken"})
        self.assertEqual(self.create({"url": "https://b.com", "alias": "taken"})["status"], 409)


class FollowLinkTest(unittest.TestCase):
    def setUp(self):
        self.app = App()
        self.code = self.app.request("POST", "/links", {"url": "https://example.com/x"})["body"]["code"]

    def test_redirects_to_the_url(self):
        res = self.app.request("GET", "/" + self.code)
        self.assertEqual(res["status"], 302)
        self.assertEqual(res["headers"]["Location"], "https://example.com/x")

    def test_unknown_code_is_a_404(self):
        self.assertEqual(self.app.request("GET", "/nope")["status"], 404)

    def test_stats_count_clicks(self):
        self.app.request("GET", "/" + self.code)
        self.app.request("GET", "/" + self.code)
        res = self.app.request("GET", f"/links/{self.code}/stats")
        self.assertEqual(res["status"], 200)
        self.assertEqual(res["body"], {"url": "https://example.com/x", "clicks": 2})
` },
      { name: 'test_links_hidden.py', hidden: true, content: `import unittest

from app import App
from codes import encode


class HiddenLinkTest(unittest.TestCase):
    def setUp(self):
        self.app = App()

    def create(self, body):
        return self.app.request("POST", "/links", body)

    def test_same_url_twice_returns_the_same_code(self):
        first = self.create({"url": "https://example.com/same"})
        second = self.create({"url": "https://example.com/same"})
        self.assertEqual(second["status"], 200)
        self.assertEqual(second["body"]["code"], first["body"]["code"])

    def test_invalid_aliases(self):
        for alias in ["ab", "x" * 31, "has space", "slash/no", "links"]:
            self.assertEqual(self.create({"url": "https://a.com", "alias": alias})["status"], 400, alias)

    def test_generated_codes_skip_aliases_already_taken(self):
        self.create({"url": "https://a.com", "alias": encode(100_000)})
        res = self.create({"url": "https://b.com"})
        self.assertEqual(res["status"], 201)
        self.assertNotEqual(res["body"]["code"], encode(100_000))
        self.assertEqual(self.app.request("GET", "/" + encode(100_000))["headers"]["Location"], "https://a.com")

    def test_stats_for_unknown_code_is_a_404(self):
        self.assertEqual(self.app.request("GET", "/links/nope/stats")["status"], 404)

    def test_missing_url_is_a_400(self):
        self.assertEqual(self.create({})["status"], 400)

    def test_stats_do_not_count_as_clicks(self):
        code = self.create({"url": "https://a.com/1"})["body"]["code"]
        self.app.request("GET", f"/links/{code}/stats")
        self.assertEqual(self.app.request("GET", f"/links/{code}/stats")["body"]["clicks"], 0)
` },
    ],
  },
  {
    id: 'task-queue',
    kind: 'backend',
    title: 'Task queue with retries',
    difficulty: 'hard',
    lang: 'javascript',
    topics: 'Async, concurrency, retries · JavaScript',
    entry: 'index.js',
    prompt: `Implement TaskQueue in src/queue.js: an in-process job queue that runs jobs through an async worker, with a concurrency limit and retries. The constructor is written; add, status, and drain are yours.

The code
• src/queue.js: the class to implement
• src/sleep.js: a real delay; tests pass their own sleep so they never wait
• index.js: queues a few jobs (Run executes it)
• test/*.test.js: the test suite, using node:test and node:assert (Run tests)

Behavior
• add(id, payload) queues a job and returns true. If a job with that id is pending or running, it does nothing and returns false. A finished id can be added again.
• status(id) is { state, attempts } plus result (when done) or error (the error's message, when failed). state is 'pending', 'running', 'done', or 'failed'. Unknown ids give undefined.
• drain() processes jobs until nothing is pending or running, then resolves. Jobs added while draining are picked up too.
• At most concurrency jobs run at once.
• A worker that throws or rejects fails that attempt. After attempt n fails, wait baseDelayMs * 2^(n-1) (using this.sleep), then try again, up to maxAttempts attempts in total.
• A job waiting to retry doesn't hold a concurrency slot.`,
    solution: `Reasonable shape: a Map of jobs, a ready list, counters for running and in-flight (running or waiting on a retry), and a pump() that starts jobs while running < concurrency.
• drain() resolves when ready is empty and nothing is in flight. Easiest: keep one idle promise and resolve it from pump().
• Wrap the worker call so synchronous throws become rejections: new Promise(r => r(worker(p))) or an async wrapper. The hidden test covers a sync throw.
• Free the slot before sleeping for a retry (hidden test: with concurrency 1, "fast" runs while "slow" waits).
• Backoff: baseDelayMs * 2 ** (attempt - 1) gives 100, 200, 400.
• Duplicates are rejected only while pending/running; a done or failed id can be re-added (hidden test).
Signals: thinks about what's in flight versus queued, tests with the injected sleep instead of real timers, keeps state transitions in one place.
Follow-ups: jitter, a dead-letter list, persistence across restarts (at-least-once delivery, idempotent workers), per-job timeouts, cancellation.`,
    files: [
      { name: 'src/queue.js', content: `const { sleep: realSleep } = require('./sleep');

// Runs jobs through an async worker, with a concurrency limit and retries.
// Implement the methods below; the question describes the exact behavior.
class TaskQueue {
  constructor({ worker, concurrency = 2, maxAttempts = 3, baseDelayMs = 100, sleep = realSleep }) {
    this.worker = worker; // async (payload) => result; throws to fail an attempt
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.sleep = sleep;
  }

  // Queue a job. Returns false (and does nothing) if a job with this id is
  // already pending or running; true otherwise.
  add(id, payload) {
    throw new Error('not implemented');
  }

  // { state: 'pending' | 'running' | 'done' | 'failed', attempts, result?, error? },
  // or undefined for an unknown id.
  status(id) {
    throw new Error('not implemented');
  }

  // Process jobs until none are pending or running. Resolves when idle.
  async drain() {
    throw new Error('not implemented');
  }
}

module.exports = { TaskQueue };
` },
      { name: 'src/sleep.js', content: `// Real delay. Tests pass their own sleep so they never actually wait.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { sleep };
` },
      { name: 'index.js', content: `const { TaskQueue } = require('./src/queue');

const tries = {};
const queue = new TaskQueue({
  baseDelayMs: 10,
  worker: async ({ email }) => {
    tries[email] = (tries[email] || 0) + 1;
    if (email.includes('flaky') && tries[email] === 1) throw new Error('SMTP timeout');
    if (email.includes('bad')) throw new Error('mailbox does not exist');
    return 'sent to ' + email;
  },
});

queue.add('w1', { email: 'ada@example.com' });
queue.add('w2', { email: 'flaky@example.com' });
queue.add('w3', { email: 'bad@example.com' });

queue.drain().then(() => {
  for (const id of ['w1', 'w2', 'w3']) console.log(id, JSON.stringify(queue.status(id)));
});
` },
      { name: 'test/queue.test.js', content: `const { test } = require('node:test');
const assert = require('node:assert');
const { TaskQueue } = require('../src/queue');

const noSleep = async () => {};

test('runs a job and records its result', async () => {
  const q = new TaskQueue({ worker: async n => n * 2, sleep: noSleep });
  assert.strictEqual(q.add('a', 21), true);
  assert.strictEqual(q.status('a').state, 'pending');
  await q.drain();
  assert.deepStrictEqual(q.status('a'), { state: 'done', attempts: 1, result: 42 });
});

test('unknown ids have no status', () => {
  const q = new TaskQueue({ worker: async () => {}, sleep: noSleep });
  assert.strictEqual(q.status('nope'), undefined);
});

test('retries a failing job, then succeeds', async () => {
  let tries = 0;
  const q = new TaskQueue({ worker: async () => { if (++tries < 3) throw new Error('flaky'); return 'ok'; }, sleep: noSleep });
  q.add('a', null);
  await q.drain();
  assert.deepStrictEqual(q.status('a'), { state: 'done', attempts: 3, result: 'ok' });
});

test('gives up after maxAttempts', async () => {
  const q = new TaskQueue({ worker: async () => { throw new Error('boom'); }, maxAttempts: 2, sleep: noSleep });
  q.add('a', null);
  await q.drain();
  assert.deepStrictEqual(q.status('a'), { state: 'failed', attempts: 2, error: 'boom' });
});

test('backs off exponentially between attempts', async () => {
  const waits = [];
  const q = new TaskQueue({
    worker: async () => { throw new Error('down'); },
    maxAttempts: 4,
    baseDelayMs: 100,
    sleep: async ms => { waits.push(ms); },
  });
  q.add('a', null);
  await q.drain();
  assert.deepStrictEqual(waits, [100, 200, 400]);
});

test('ignores a duplicate id while the job is pending', async () => {
  const q = new TaskQueue({ worker: async x => x, sleep: noSleep });
  assert.strictEqual(q.add('a', 1), true);
  assert.strictEqual(q.add('a', 2), false);
  await q.drain();
  assert.strictEqual(q.status('a').result, 1);
});
` },
      { name: 'test/concurrency.test.js', content: `const { test } = require('node:test');
const assert = require('node:assert');
const { TaskQueue } = require('../src/queue');

const tick = () => new Promise(resolve => setImmediate(resolve));

test('never runs more than \`concurrency\` jobs at once', async () => {
  let active = 0;
  let peak = 0;
  const q = new TaskQueue({
    concurrency: 3,
    sleep: async () => {},
    worker: async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      await tick();
      active--;
    },
  });
  for (let i = 0; i < 10; i++) q.add('job' + i, i);
  await q.drain();
  assert.strictEqual(peak, 3);
  for (let i = 0; i < 10; i++) assert.strictEqual(q.status('job' + i).state, 'done');
});
` },
      { name: 'test/hidden.test.js', hidden: true, content: `const { test } = require('node:test');
const assert = require('node:assert');
const { TaskQueue } = require('../src/queue');

const noSleep = async () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('an id can be added again once its job has finished', async () => {
  const q = new TaskQueue({ worker: async x => x, sleep: noSleep });
  q.add('a', 1);
  await q.drain();
  assert.strictEqual(q.add('a', 2), true);
  await q.drain();
  assert.deepStrictEqual(q.status('a'), { state: 'done', attempts: 1, result: 2 });
});

test('a duplicate is ignored while the job is running', async () => {
  let release;
  const q = new TaskQueue({ worker: () => new Promise(r => { release = r; }), sleep: noSleep });
  q.add('a', null);
  const done = q.drain();
  await tick();
  assert.strictEqual(q.status('a').state, 'running');
  assert.strictEqual(q.add('a', null), false);
  release('x');
  await done;
  assert.strictEqual(q.status('a').state, 'done');
});

test('a job waiting on a retry does not block other jobs', async () => {
  const order = [];
  const q = new TaskQueue({
    concurrency: 1,
    worker: async name => {
      order.push(name);
      if (name === 'slow' && order.filter(n => n === 'slow').length === 1) throw new Error('retry me');
      return name;
    },
    sleep: () => tick(),
  });
  q.add('1', 'slow');
  q.add('2', 'fast');
  await q.drain();
  assert.deepStrictEqual(order, ['slow', 'fast', 'slow']);
});

test('jobs added while draining are processed by the same drain', async () => {
  const q = new TaskQueue({ worker: async x => { if (x === 1) q.add('b', 2); return x; }, sleep: noSleep });
  q.add('a', 1);
  await q.drain();
  assert.strictEqual(q.status('b').state, 'done');
});

test('drain on an empty queue resolves', async () => {
  const q = new TaskQueue({ worker: async () => {}, sleep: noSleep });
  await q.drain();
});

test('a worker that throws synchronously counts as a failed attempt', async () => {
  const q = new TaskQueue({ worker: () => { throw new Error('sync'); }, maxAttempts: 1, sleep: noSleep });
  q.add('a', null);
  await q.drain();
  assert.deepStrictEqual(q.status('a'), { state: 'failed', attempts: 1, error: 'sync' });
});
` },
    ],
  },
];

// Starting points for writing your own practical.
window.ONSITE_PROJECT_TEMPLATES = {
  python: {
    entry: 'main.py',
    files: [
      { name: 'main.py', content: `from app import greet

print(greet("world"))
` },
      { name: 'app.py', content: `def greet(name):
    return f"Hello, {name}!"
` },
      { name: 'test_app.py', content: `import unittest

from app import greet


class GreetTest(unittest.TestCase):
    def test_greets_by_name(self):
        self.assertEqual(greet("Ada"), "Hello, Ada!")


# Plain pytest-style functions work too.
def test_greet_world():
    assert greet("world") == "Hello, world!"
` },
    ],
  },
  javascript: {
    entry: 'index.js',
    files: [
      { name: 'index.js', content: `const { greet } = require('./app');

console.log(greet('world'));
` },
      { name: 'app.js', content: `function greet(name) {
  return 'Hello, ' + name + '!';
}

module.exports = { greet };
` },
      { name: 'app.test.js', content: `const test = require('node:test');
const assert = require('node:assert');
const { greet } = require('./app');

test('greets by name', () => {
  assert.strictEqual(greet('Ada'), 'Hello, Ada!');
});
` },
    ],
  },
};
