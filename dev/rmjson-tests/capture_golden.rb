#!/usr/bin/env ruby
# Captures old-tool dumps as golden fixtures. MUST be run before
# 3rdParty/rmxp_translator is deleted. Output: dev/rmjson-tests/golden/<set>/...
require "fileutils"
require "open3"

APP = File.expand_path("../..", __dir__)
RUBY = File.join(APP, "ruby/bin/ruby")
OLD = File.join(APP, "3rdParty/rmxp_translator")
GOLD = File.join(__dir__, "golden")

def dump_with(old_script, data_dir, out_set, only: nil)
  dest = File.join(GOLD, out_set)
  FileUtils.rm_rf(dest)      # idempotent re-runs: avoid the old tool's prompt
  FileUtils.mkdir_p(dest)
  Dir[File.join(data_dir, "*")].sort.each do |f|
    next unless File.file?(f)
    next if only && !only.call(f)
    ext = File.extname(f)
    next unless [".rxdata", ".rvdata", ".rvdata2"].include?(ext)
    out, st = Open3.capture3(RUBY, File.join(OLD, old_script), "--dump=#{f}", "--dest=#{dest}")
    json = f.sub(/#{Regexp.escape(ext)}\z/, ".json")
    puts "#{File.basename(f)}: #{File.file?(File.join(dest, File.basename(json))) ? 'OK' : "MISSING (#{$?.exitstatus}) #{out.lines.last}"}"
  end
end

# NOTE: the former ace-A/ace-B sets were dumps of commercial games the
# project holds no rights to; they were removed from the repo. Regenerate
# ace coverage from synthetic sources only (golden-src/ace -> ace-synth).
# To capture goldens against a game you own, pass its Data dir explicitly:
#   dump_with("rmvxace_translator.rb", ENV["RMJSON_ACE_DATA"], "ace-local")
# (keep such sets out of the repository).
# XP / VX: per-engine old scripts over synthetic fixtures (the per-engine old behavior,
# which is what the new tool reproduces; SLR's old ace-routing for xp/vx is the bug we fix)
dump_with("rmxp_translator.rb", File.join(__dir__, "golden-src/xp"), "xp")
dump_with("rmvx_translator.rb", File.join(__dir__, "golden-src/vx"), "vx")
# synthetic ace: directly exercises the code-122 sticky-bug delta (scripted 122
# followed by an ordinary 122 in the same file)
dump_with("rmvxace_translator.rb", File.join(__dir__, "golden-src/ace"), "ace-synth")
puts "golden capture done"
