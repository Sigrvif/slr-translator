# t_apply_parity.rb — loads FIRST alphabetically, so it must be self-sufficient:
# SOURCES/TESTS/RUBY/APP/Model come from run_tests.rb (loaded before t_* files).

# Fresh-process re-marshal of a data file (same technique as t_roundtrip's
# marshal_bytes: CRuby >= 2.5 caches per-class ivar slot order, so the
# reference must come from a subprocess that loaded only this file).
require "open3"
PARITY_BIN = File.join(APP, "www/php/plugins/rmvxace/bin")
PARITY_CODE = '$LOAD_PATH.unshift(ARGV[1]); require "model"; STDOUT.binmode; ' \
              'STDOUT.write(Marshal.dump(Model.load(ARGV[0])))'
def parity_ref_bytes(path)
  out, _err, st = Open3.capture3(RUBY, "-e", PARITY_CODE, path, PARITY_BIN)
  return nil unless st.success? && !out.empty?
  out.force_encoding("ASCII-8BIT")
end

if File.directory?(File.join(APP, "3rdParty/rmxp_translator"))
  OLD = File.join(APP, "3rdParty/rmxp_translator")
  OLD_ENTRY = {
    "ace-synth" => "rmvxace_translator.rb",
    "xp" => "rmxp_translator.rb", "vx" => "rmvx_translator.rb",
  }.freeze
  # ace CommonEvents is excluded: the old tool re-merges instead of splitting
  # (documented bug fix delta); xp/vx split correctly and ARE compared.
  ACE_EXCLUDE_BASE = ["CommonEvents.rvdata2"].freeze

  def t_apply_parity
    SOURCES.each do |set, src_dir|
      engine_entry = OLD_ENTRY[set]
      next if engine_entry.nil?
      Dir[File.join(src_dir, "*")].sort.each do |src|
        next unless DATA_EXTS.include?(File.extname(src))
        next if set.start_with?("ace") && ACE_EXCLUDE_BASE.include?(File.basename(src))
        base = File.basename(src)
        work = File.join(TESTS, "parity-#{set}")        # per-set dir: games share basenames
        dump_old = File.join(work, "dump-old")
        FileUtils.rm_rf(dump_old)
        FileUtils.mkdir_p(dump_old)
        system(RUBY, File.join(OLD, engine_entry), "--dump=#{src}", "--dest=#{dump_old}")

        json_old = File.join(dump_old, base.sub(/\.[^.]+\z/, ".json"))
        next unless File.file?(json_old)

        # place the old-format JSON as sibling so BOTH tools translate it
        sibling = src.sub(/\.[^.]+\z/, ".json")
        copied = !File.file?(sibling)
        assert(copied, "#{set}: stale sibling json pre-exists next to #{base} — remove it")
        FileUtils.cp(json_old, sibling) if copied
        begin
          out_old = File.join(work, "out-old"); out_new = File.join(work, "out-new")
          FileUtils.rm_rf(out_old); FileUtils.rm_rf(out_new)
          FileUtils.mkdir_p(out_old); FileUtils.mkdir_p(out_new)
          ok_old = system(RUBY, File.join(OLD, engine_entry),
                          "--translate=#{src}", "--dest=#{out_old}")
          out, code_new = run_tool("--translate=#{src}", "--dest=#{out_new}")
          assert(code_new == 0, "#{set}/#{base}: new tool applies old-format JSON")
          if ok_old && File.file?(File.join(out_old, base)) && File.file?(File.join(out_new, base))
            old_bin = File.binread(File.join(out_old, base))
            new_bin = File.binread(File.join(out_new, base))
            if old_bin == new_bin
              assert(true, "#{set}/#{base}: translated marshal output byte-identical to old tool")
            else
              # Known legacy-apply corruption (old tool bug the new tool fixes,
              # pinned by t_roundtrip's byte-stable round-trip; reproducing it in
              # the new tool would corrupt data and fail t_roundtrip):
              #   - Enemies: translate_string ASSIGNS fields whose JSON value is
              #     null, adding nil ivars (e.g. @description) the original data
              #     never had;
              #   - ace-B maps: split_event_commands allocates fresh
              #     RPG::EventCommand objects, dropping extra ivars (e.g.
              #     @features) that modded games attach, but only on split
              #     pieces. The new tool preserves them (rmjson.rb runs-reuse).
              # Assert the documented behavior instead: the new tool's output is
              # byte-identical to a fresh re-marshal of the ORIGINAL data file.
              ref = parity_ref_bytes(src)
              assert(!ref.nil? && new_bin == ref,
                     "#{set}/#{base}: legacy apply corrupts data (documented fix); " \
                     "new tool output byte-stable vs original")
            end
          end
        ensure
          File.delete(sibling) if copied && File.file?(sibling)
        end
      end
    end
  end
  t_apply_parity
else
  puts "note: old tool removed; t_apply_parity skipped (golden + roundtrip tests remain)"
end

def t_apply_filled
  require "tmpdir"
  Dir.mktmpdir("filled") do |d|
    src_dir = File.join(__dir__, "golden-src/ace")
    work = File.join(d, "w"); FileUtils.mkdir_p(work)
    run_tool("--dump=#{File.join(src_dir, "Actors.rvdata2")}", "--dest=#{work}")
    run_tool("--dump=#{File.join(src_dir, "CommonEvents.rvdata2")}", "--dest=#{work}")

    a_json = File.join(src_dir, "Actors.json")
    c_json = File.join(src_dir, "CommonEvents.json")
    FileUtils.cp(File.join(work, "Actors.json"), a_json)
    FileUtils.cp(File.join(work, "CommonEvents.json"), c_json)
    begin
      j = JSON.parse(File.read(a_json))
      j[1][1]["name"][TRAN_KEY] = "Rerika"
      j[1][1]["note"][TRAN_KEY] = "a note"
      File.write(a_json, JSON.pretty_generate(j))

      jc = JSON.parse(File.read(c_json))
      run0 = jc[1][1]["commands"][0]        # merged Show Text run (2 lines)
      run0["parameters"][TRAN_KEY] = ["line one", "second line"]
      File.write(c_json, JSON.pretty_generate(jc))

      out_dir = File.join(d, "out"); FileUtils.mkdir_p(out_dir)
      _, code = run_tool("--translate=#{File.join(src_dir, "Actors.rvdata2")}", "--dest=#{out_dir}")
      assert(code == 0, "filled Actors translate ok")
      actors = Model.load(File.join(out_dir, "Actors.rvdata2"))
      assert_eq("Rerika", actors[1].instance_variable_get(:@name), "actor name translated")
      assert_eq("a note", actors[1].instance_variable_get(:@note), "actor note translated")
      assert_eq("ハルカ", actors[2].instance_variable_get(:@name), "untranslated actor untouched")

      _, code = run_tool("--translate=#{File.join(src_dir, "CommonEvents.rvdata2")}", "--dest=#{out_dir}")
      assert(code == 0, "filled CommonEvents translate ok")
      ce = Model.load(File.join(out_dir, "CommonEvents.rvdata2"))
      list = ce[1].instance_variable_get(:@list)
      codes = list.map { |c| c.instance_variable_get(:@code) }
      # CommonEvent split fix: merged 401 run must come back SPLIT (401, 401)
      assert_eq([401, 401], codes[0, 2], "common event text run split back (old-tool bug fix)")
      assert_eq("line one", list[0].instance_variable_get(:@parameters)[0], "first text line")
      assert_eq("second line", list[1].instance_variable_get(:@parameters)[0], "second text line")

      # negative: mismatched original must exit 1
      j[1][1]["name"][ORIG_KEY] = "WRONG"
      File.write(a_json, JSON.pretty_generate(j))
      _, code = run_tool("--translate=#{File.join(src_dir, "Actors.rvdata2")}", "--dest=#{out_dir}")
      assert(code == 1, "mismatched original exits 1 (old tool exited 0)")

      # code-122 behavior: scripted dumps params, ordinary does not
      dump_dir = File.join(d, "d2"); FileUtils.mkdir_p(dump_dir)
      run_tool("--dump=#{File.join(src_dir, "CommonEvents.rvdata2")}", "--dest=#{dump_dir}")
      j2 = JSON.parse(File.read(File.join(dump_dir, "CommonEvents.json")))
      types = j2[1][1]["commands"].map { |c| [c["type"], c.key?("parameters")] }
      assert(types.include?(["Control Variables", true]), "scripted 122 dumps parameters")
      assert(types.include?(["Control Variables", false]), "ordinary 122 dumps no parameters (sticky bug fixed)")
    ensure
      File.delete(a_json) if File.file?(a_json)
      File.delete(c_json) if File.file?(c_json)
    end
  end
end
t_apply_filled

def t_apply_differing_length
  require "tmpdir"
  Dir.mktmpdir("difflen") do |d|
    src_dir = File.join(__dir__, "golden-src/ace")
    c_json = File.join(src_dir, "CommonEvents.json")
    work = File.join(d, "w"); FileUtils.mkdir_p(work)
    run_tool("--dump=#{File.join(src_dir, "CommonEvents.rvdata2")}", "--dest=#{work}")
    FileUtils.cp(File.join(work, "CommonEvents.json"), c_json)
    begin
      jc = JSON.parse(File.read(c_json))
      jc[1][1]["commands"][0]["parameters"][TRAN_KEY] = ["one line only"]
      File.write(c_json, JSON.pretty_generate(jc))
      out_dir = File.join(d, "out"); FileUtils.mkdir_p(out_dir)
      _, code = run_tool("--translate=#{File.join(src_dir, "CommonEvents.rvdata2")}", "--dest=#{out_dir}")
      assert(code == 0, "differing-length translate ok")
      ce = Model.load(File.join(out_dir, "CommonEvents.rvdata2"))
      list = ce[1].instance_variable_get(:@list)
      assert_eq("one line only", list[0].instance_variable_get(:@parameters)[0], "shorter translation applied")
      assert_eq(401, list[0].instance_variable_get(:@code), "first piece keeps head code")
      # Fixture command_list (ace): [401,401,101,102,108,355,655,122,122,999,320,0];
      # after merge commands[0] is the 2-line 401 run, commands[1] the 101 attributes
      # cmd. Collapsing the run to 1 line shifts the 101 up to index 1.
      assert_eq(101, list[1].instance_variable_get(:@code), "command AFTER the shrunken run shifts up (list is one shorter)")
      # total list is one command shorter than the original 12-command fixture
      assert_eq(11, list.length, "run of 2 -> 1 command")
    ensure
      File.delete(c_json) if File.file?(c_json)
    end
  end
end
t_apply_differing_length
