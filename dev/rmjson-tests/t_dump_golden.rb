require "json"

GOLD = File.join(__dir__, "golden")
# SOURCES is defined by run_tests.rb (loaded first).

# Strip "parameters" from Control Variables entries (old tool's sticky-table
# bug: a scripted code-122 made every later 122 in the same file translatable).
def strip_122(node)
  case node
  when Hash
    h = node.dup
    h.delete("parameters") if h["type"] == "Control Variables"
    h.each { |k, v| h[k] = strip_122(v) }
    h
  when Array then node.map { |e| strip_122(e) }
  else node
  end
end

def t_dump_golden
  SOURCES.each do |set, src_dir|
    dest = File.join(TESTS, "dump-#{set}")
    FileUtils.mkdir_p(dest)
    golden_dir = File.join(GOLD, set)
    golden_scripts = File.join(golden_dir, "scripts")
    new_scripts = File.join(dest, "scripts")

    Dir[File.join(golden_dir, "*.json")].sort.each do |golden|
      base = File.basename(golden)
      src = Dir[File.join(src_dir, base.sub(/\.json\z/, ".*"))].first
      assert(!src.nil?, "#{set}/#{base}: source data file exists")
      next if src.nil?
      out, code = run_tool("--dump=#{src}", "--dest=#{dest}")
      assert(code == 0, "#{set}/#{base}: dump exit 0")

      produced = File.join(dest, base)
      assert(File.file?(produced), "#{set}/#{base}: JSON produced")
      next unless File.file?(produced)

      g = File.read(golden).gsub(golden_scripts, "SCRIPTS_DIR")
      n = File.read(produced).gsub(new_scripts, "SCRIPTS_DIR")
      if g == n
        assert(true, "#{set}/#{base}: byte-identical")
      else
        # sole allowed exception: code-122 sticky-table differences.
        # Compare ORDER-SENSITIVELY (pretty_generate of the parsed trees) so a
        # key-order regression cannot hide behind this fallback.
        same_modulo_122 = JSON.pretty_generate(strip_122(JSON.parse(g))) ==
                          JSON.pretty_generate(strip_122(JSON.parse(n)))
        assert(same_modulo_122,
               "#{set}/#{base}: identical modulo documented 122 delta (else REAL DIFF)")
      end
    end

    # Scripts sidecars must also match the golden sidecars
    Dir[File.join(golden_scripts, "*.rb")].sort.each do |gr|
      rel = gr.sub(golden_scripts, "")
      nr = File.join(new_scripts, rel)
      ok = File.file?(nr) && File.read(nr) == File.read(gr)
      assert(ok, "#{set}/scripts#{rel}: sidecar identical")
    end
  end
end
t_dump_golden
