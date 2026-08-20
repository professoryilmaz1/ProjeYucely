# KREVUNO Global 150-Country Public Job Sweep

KREVUNO activates 10 countries immediately, then adds 10 more every four hours until 150 countries are active. China (CN) is excluded by owner request.

Each active country is checked once per hour across three Cloudflare Cron shards at minute 0, 20 and 40. The source policy permits only public or explicitly reusable feeds without paid API access, membership, or access-control bypass. Closed or permissioned job platforms remain outbound links only.

Primary country-filtered source: Himalayas public JSON jobs API (no authentication; visible source attribution and original link required). Existing KREVUNO public sources remain in place and are not replaced.

Production safeguards: source URLs retained, dedupe on source_provider/source_id, stale external jobs expire, bounded fetch size, request timeouts, sharded concurrency, CI syntax/tests, and Wrangler dry-run before deployment.
