#!/usr/bin/env ruby
# Minimal assert framework for the rmjson test suite. Run with the bundled Ruby:
#   "/workspaces/dev/SLR Translator Linux/ruby/bin/ruby" dev/rmjson-tests/run_tests.rb
$LOAD_PATH.unshift(File.expand_path(__dir__))
$LOAD_PATH.unshift(File.expand_path("../../www/php/plugins/rmvxace/bin", __dir__))
require "fileutils"
require "tmpdir"
require "rbconfig"
require "json"
require "model"

APP   = File.expand_path("../..", __dir__)            # LNX app root
TOOL  = File.join(APP, "www/php/plugins/rmvxace/bin/rmjson.rb")
RUBY  = RbConfig.ruby
TESTS = Dir.mktmpdir("rmjson-tests")
FINAL = []

ORIG_KEY = "original   "                              # padded legacy key (11 chars)
TRAN_KEY = "translation"
SOURCES = {                                           # golden set -> source data dir
  # ace-A / ace-B were dumps of commercial games the project holds no rights
  # to and were removed; ace coverage comes from the synthetic set below.
  "xp"    => File.join(__dir__, "golden-src/xp"),
  "vx"    => File.join(__dir__, "golden-src/vx"),
  "ace-synth" => File.join(__dir__, "golden-src/ace"),
}
DATA_EXTS = [".rxdata", ".rvdata", ".rvdata2"].freeze

at_exit do
  FileUtils.rm_rf(TESTS) if FINAL[0]
  if $failed > 0
    puts "#{$count - $passed}/#{$count} FAILED"
    exit 1
  end
  puts "all #{$count} assertions passed"
end

$count = 0; $passed = 0; $failed = 0
def assert(cond, label)
  $count += 1
  if cond then $passed += 1
  else
    $failed += 1
    puts "FAIL: #{label}"
    puts "  at #{caller(1..1).first}"
  end
end
def assert_eq(exp, got, label)
  if exp == got
    assert(true, label)
  else
    assert(false, label)
    puts "  expected: #{exp.inspect[0, 300]}"
    puts "  got:      #{got.inspect[0, 300]}"
  end
end

# Run the rmjson CLI; returns [stdout, exit_code].
def run_tool(*args)
  require "open3"
  out, _err, st = Open3.capture3(RUBY, TOOL, *args.map(&:to_s))
  [out, st.exitstatus]
end

Dir["#{__dir__}/t_*.rb"].sort.each do |t|
  begin
    require t
  rescue StandardError, ScriptError => e
    $failed += 1
    puts "LOAD FAIL: #{File.basename(t)}: #{e.class}: #{e.message}"
  end
end
FINAL[0] = true
