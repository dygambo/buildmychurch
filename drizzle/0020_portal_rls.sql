-- Member portal codes are church data; sessions are looked up before the church is known (like staff sessions).
SELECT bmc_enable_tenant_rls('member_codes'::regclass);
