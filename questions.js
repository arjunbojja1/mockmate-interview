// Hand-written questions with hidden test cases and reference approaches.
// Ids are LeetCode slugs so they line up with the NeetCode 150 list
// (neetcode150.js); these override the fetched version of the same problem.
// Every problem here has a single deterministic answer per input (no
// "return in any order"), so the exact-match test runner can grade it.
window.ONSITE_QUESTIONS = [
  {
    id: 'two-sum',
    title: 'Two Sum',
    difficulty: 'easy',
    topics: 'Hash map',
    prompt: `Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.

Each input has exactly one solution, and you may not use the same element twice. Return the indices in increasing order.

Example 1
Input: nums = [2,7,11,15], target = 9
Output: [0,1]

Example 2
Input: nums = [3,2,4], target = 6
Output: [1,2]

Constraints
• 2 <= nums.length <= 10^4
• -10^9 <= nums[i], target <= 10^9`,
    starter: {
      python: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n',
      javascript: '/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction twoSum(nums, target) {\n\n}\n',
    },
    tests: [
      { input: '[2,7,11,15]\n9', expected: '[0,1]' },
      { input: '[3,2,4]\n6', expected: '[1,2]' },
      { input: '[3,3]\n6', expected: '[0,1]' },
      { input: '[-1,-2,-3,-4,-5]\n-8', expected: '[2,4]', hidden: true },
    ],
    solution: `One pass with a hash map from value to index: for each nums[i], check whether target - nums[i] was already seen.
Time O(n), space O(n).
Brute force O(n^2) is a fine start; push for the map.
Follow-up: input is sorted → two pointers, O(1) space.`,
  },
  {
    id: 'valid-parentheses',
    title: 'Valid Parentheses',
    difficulty: 'easy',
    topics: 'Stack',
    prompt: `Given a string s containing only the characters ( ) { } [ ], decide whether it is valid.

A string is valid when every opening bracket is closed by the same type of bracket, in the correct order.

Example 1
Input: s = "()[]{}"
Output: true

Example 2
Input: s = "(]"
Output: false

Constraints
• 1 <= s.length <= 10^4`,
    starter: {
      python: 'class Solution:\n    def isValid(self, s: str) -> bool:\n        pass\n',
      javascript: '/**\n * @param {string} s\n * @return {boolean}\n */\nfunction isValid(s) {\n\n}\n',
    },
    tests: [
      { input: '"()[]{}"', expected: 'true' },
      { input: '"(]"', expected: 'false' },
      { input: '"([{}])"', expected: 'true' },
      { input: '"(("', expected: 'false', hidden: true },
      { input: '"]"', expected: 'false', hidden: true },
    ],
    solution: `Stack of open brackets; on a closer, the top must be its partner. Valid iff the stack ends empty.
Time O(n), space O(n).
Watch for: closer on an empty stack, leftover openers.`,
  },
  {
    id: 'longest-substring-without-repeating-characters',
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'medium',
    topics: 'Sliding window',
    prompt: `Given a string s, return the length of the longest substring that contains no repeated characters.

Example 1
Input: s = "abcabcbb"
Output: 3
Explanation: "abc"

Example 2
Input: s = "pwwkew"
Output: 3
Explanation: "wke" — a subsequence like "pwke" doesn't count.

Constraints
• 0 <= s.length <= 5 * 10^4`,
    starter: {
      python: 'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        pass\n',
      javascript: '/**\n * @param {string} s\n * @return {number}\n */\nfunction lengthOfLongestSubstring(s) {\n\n}\n',
    },
    tests: [
      { input: '"abcabcbb"', expected: '3' },
      { input: '"bbbbb"', expected: '1' },
      { input: '"pwwkew"', expected: '3' },
      { input: '""', expected: '0', hidden: true },
      { input: '"abba"', expected: '2', hidden: true },
    ],
    solution: `Sliding window with last-seen index per character; on a repeat, move left to max(left, last[c] + 1).
Time O(n), space O(alphabet).
"abba" catches solutions that move left backwards.`,
  },
  {
    id: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'medium',
    topics: 'Sorting',
    prompt: `Given an array of intervals where intervals[i] = [start, end], merge all overlapping intervals and return the result sorted by start.

Intervals that touch (one ends where the next starts) overlap.

Example 1
Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]

Example 2
Input: intervals = [[1,4],[4,5]]
Output: [[1,5]]

Constraints
• 1 <= intervals.length <= 10^4`,
    starter: {
      python: 'class Solution:\n    def merge(self, intervals: List[List[int]]) -> List[List[int]]:\n        pass\n',
      javascript: '/**\n * @param {number[][]} intervals\n * @return {number[][]}\n */\nfunction merge(intervals) {\n\n}\n',
    },
    tests: [
      { input: '[[1,3],[2,6],[8,10],[15,18]]', expected: '[[1,6],[8,10],[15,18]]' },
      { input: '[[1,4],[4,5]]', expected: '[[1,5]]' },
      { input: '[[1,4],[0,4]]', expected: '[[0,4]]', hidden: true },
      { input: '[[1,4],[2,3]]', expected: '[[1,4]]', hidden: true },
    ],
    solution: `Sort by start; extend the last merged interval while the next start <= its end (take max of ends).
Time O(n log n), space O(n) for output.
[[1,4],[2,3]] catches using the new end instead of max.`,
  },
  {
    id: 'product-of-array-except-self',
    title: 'Product of Array Except Self',
    difficulty: 'medium',
    topics: 'Prefix sums',
    prompt: `Given an integer array nums, return an array answer where answer[i] is the product of every element of nums except nums[i].

Solve it in O(n) time without using division.

Example 1
Input: nums = [1,2,3,4]
Output: [24,12,8,6]

Example 2
Input: nums = [-1,1,0,-3,3]
Output: [0,0,9,0,0]

Constraints
• 2 <= nums.length <= 10^5`,
    starter: {
      python: 'class Solution:\n    def productExceptSelf(self, nums: List[int]) -> List[int]:\n        pass\n',
      javascript: '/**\n * @param {number[]} nums\n * @return {number[]}\n */\nfunction productExceptSelf(nums) {\n\n}\n',
    },
    tests: [
      { input: '[1,2,3,4]', expected: '[24,12,8,6]' },
      { input: '[-1,1,0,-3,3]', expected: '[0,0,9,0,0]' },
      { input: '[0,0]', expected: '[0,0]', hidden: true },
    ],
    solution: `Prefix products left-to-right into the output, then multiply in suffix products right-to-left with a running variable.
Time O(n), O(1) extra space beyond the output.
Division breaks on zeros — a good probe if they reach for it.`,
  },
  {
    id: 'number-of-islands',
    title: 'Number of Islands',
    difficulty: 'medium',
    topics: 'Graph traversal',
    prompt: `Given an m x n grid of "1" (land) and "0" (water), return the number of islands.

An island is land connected horizontally or vertically and surrounded by water. The grid's edges are all water.

Example 1
Input: grid = [
  ["1","1","0","0","0"],
  ["1","1","0","0","0"],
  ["0","0","1","0","0"],
  ["0","0","0","1","1"]
]
Output: 3

Constraints
• 1 <= m, n <= 300`,
    starter: {
      python: 'class Solution:\n    def numIslands(self, grid: List[List[str]]) -> int:\n        pass\n',
      javascript: '/**\n * @param {character[][]} grid\n * @return {number}\n */\nfunction numIslands(grid) {\n\n}\n',
    },
    tests: [
      { input: '[["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', expected: '3' },
      { input: '[["1","1","1"],["0","1","0"],["1","1","1"]]', expected: '1' },
      { input: '[["0"]]', expected: '0', hidden: true },
      { input: '[["1","0","1","0","1"]]', expected: '3', hidden: true },
    ],
    solution: `Scan cells; on unvisited land, count++ and flood-fill (DFS/BFS) marking visited.
Time O(mn), space O(mn) worst case for recursion/queue.
Ask about recursion depth on a 300x300 all-land grid → iterative BFS.`,
  },
  {
    id: 'coin-change',
    title: 'Coin Change',
    difficulty: 'medium',
    topics: 'Dynamic programming',
    prompt: `Given coin denominations coins and a total amount, return the fewest coins needed to make that amount, or -1 if it can't be made. You have unlimited coins of each kind.

Example 1
Input: coins = [1,2,5], amount = 11
Output: 3
Explanation: 5 + 5 + 1

Example 2
Input: coins = [2], amount = 3
Output: -1

Constraints
• 1 <= coins.length <= 12
• 0 <= amount <= 10^4`,
    starter: {
      python: 'class Solution:\n    def coinChange(self, coins: List[int], amount: int) -> int:\n        pass\n',
      javascript: '/**\n * @param {number[]} coins\n * @param {number} amount\n * @return {number}\n */\nfunction coinChange(coins, amount) {\n\n}\n',
    },
    tests: [
      { input: '[1,2,5]\n11', expected: '3' },
      { input: '[2]\n3', expected: '-1' },
      { input: '[1]\n0', expected: '0' },
      { input: '[186,419,83,408]\n6249', expected: '20', hidden: true },
    ],
    solution: `Bottom-up DP: dp[a] = min over coins of dp[a - c] + 1, dp[0] = 0.
Time O(amount * coins), space O(amount).
Greedy fails (e.g. coins [1,3,4], amount 6) — ask why. The hidden case times out naive recursion.`,
  },
  {
    id: 'trapping-rain-water',
    title: 'Trapping Rain Water',
    difficulty: 'hard',
    topics: 'Two pointers',
    prompt: `Given n non-negative integers for an elevation map where each bar is 1 wide, compute how much water it traps after raining.

Example 1
Input: height = [0,1,0,2,1,0,1,3,2,1,2,1]
Output: 6

Example 2
Input: height = [4,2,0,3,2,5]
Output: 9

Constraints
• 1 <= n <= 2 * 10^4
• 0 <= height[i] <= 10^5`,
    starter: {
      python: 'class Solution:\n    def trap(self, height: List[int]) -> int:\n        pass\n',
      javascript: '/**\n * @param {number[]} height\n * @return {number}\n */\nfunction trap(height) {\n\n}\n',
    },
    tests: [
      { input: '[0,1,0,2,1,0,1,3,2,1,2,1]', expected: '6' },
      { input: '[4,2,0,3,2,5]', expected: '9' },
      { input: '[5]', expected: '0', hidden: true },
      { input: '[5,4,3,2,1]', expected: '0', hidden: true },
    ],
    solution: `Water at i = min(maxLeft, maxRight) - height[i].
Prefix/suffix max arrays: O(n) time and space. Two pointers moving the smaller side inward: O(n) time, O(1) space.
Monotonic stack is also valid.`,
  },
];
