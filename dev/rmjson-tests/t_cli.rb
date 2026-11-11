def t_cli
  out, code = run_tool("--help")
  assert(code == 0 && out.include?("--dump="), "--help exits 0 with usage")

  out, code = run_tool
  assert(code == 1 && out.include?("Usage"), "no arguments exits 1 with usage")

  out, code = run_tool("--bogus=1")
  assert(code == 1, "unknown argument exits 1")

  out, code = run_tool("--dump=whatever", "--dest=/nonexistent-dir-xyz")
  assert(code == 1 && out.include?("dest"), "invalid dest exits 1")

  out, code = run_tool("--dump")
  assert(code == 1, "missing value exits 1")
end
t_cli
