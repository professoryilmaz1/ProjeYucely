# ProjeYucely v1.4

## Mutual Match Engine
- Added real mutual matching for RELATIONSHIP, BUSINESS, MENTOR, FRIEND.
- Two-way scoring: A must fit B's criteria and B must fit A's criteria.
- Explicit opt-in and discoverability required.
- Sensitive/unapproved criteria are stripped from the matching criteria schema.
- Private contact is not revealed until both users approve the connection.
- Match profiles and connections persist in MemoryStore and SQLiteStore.
- Added authenticated API endpoints for profile creation, match discovery, connection creation, mutual approval, and connection listing.
- Audit and feature events added for match operations.

## Verification
- Core test suite: 42/42 passed.
- HTTP smoke flow: two users -> two profiles -> mutual match -> connection -> first approval remains private -> second approval reveals contact flag.
