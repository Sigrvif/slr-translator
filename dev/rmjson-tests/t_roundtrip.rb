require "zlib"

def marshal_bytes(path)
  # CRuby >= 2.5 caches the ivar-name -> slot order per class for the whole
  # process: once files from other games have been loaded, Model.load of a
  # later file stores shared-class ivars (RPG::Actor etc.) in the previously
  # allocated slot order, so an in-process Marshal.dump diverges from what a
  # clean load of that file produces. Re-marshal in a fresh subprocess so the
  # reference bytes match the tool's own fresh-process view of the file.
  require "open3"
  code = '$LOAD_PATH.unshift(ARGV[1]); require "model"; STDOUT.binmode; ' \
         'STDOUT.write(Marshal.dump(Model.load(ARGV[0])))'
  bin = File.expand_path("../../www/php/plugins/rmvxace/bin", __dir__)
  out, err, st = Open3.capture3(RbConfig.ruby, "-e", code, path, bin)
  raise "marshal_bytes failed for #{path}: #{err}" unless st.success? && !out.empty?
  out.force_encoding("ASCII-8BIT")
end

def sub_json_ext_local(path)
  path.sub(/\.[^.]+\z/, ".json")
end

def roundtrip_file(src, set)
  work = File.join(TESTS, "rt-#{set}")
  FileUtils.mkdir_p(work)
  json_dir = File.join(work, "dump")
  FileUtils.mkdir_p(json_dir)
  out, code = run_tool("--dump=#{src}", "--dest=#{json_dir}")
  assert(code == 0, "#{set}/#{File.basename(src)}: dump ok")

  # translate reads the SIBLING json next to the data file — put it there
  sibling = sub_json_ext_local(src)
  copied = !File.file?(sibling)
  assert(copied, "#{set}: stale sibling json pre-exists next to #{File.basename(src)} — remove it")
  FileUtils.cp(File.join(json_dir, File.basename(sibling)), sibling) if copied
  begin
    out_dir = File.join(work, "out")
    FileUtils.mkdir_p(out_dir)
    out, code = run_tool("--translate=#{src}", "--dest=#{out_dir}")
    assert(code == 0, "#{set}/#{File.basename(src)}: translate ok")
    produced = File.join(out_dir, File.basename(src))
    assert(File.file?(produced), "#{set}/#{File.basename(src)}: output written")

    if File.basename(src, ".*") == "Scripts"
      # Scripts: compare inflated [magic, name, text] triplets, not zipped bytes
      a = Model.load(src); b = Model.load(produced)
      assert(a.length == b.length, "#{set}/Scripts: triplet count")
      a.zip(b).each_with_index do |pair, i|
        ta, tb = pair
        assert(ta[0] == tb[0], "#{set}/Scripts[#{i}]: magic")
        assert(ta[1] == tb[1], "#{set}/Scripts[#{i}]: name")
        assert(Zlib::Inflate.inflate(ta[2]) == Zlib::Inflate.inflate(tb[2]),
               "#{set}/Scripts[#{i}]: text")
      end
    else
      assert(File.binread(produced) == marshal_bytes(src),
             "#{set}/#{File.basename(src)}: byte-identical empty-translation round-trip")
    end
  ensure
    File.delete(sibling) if copied && File.file?(sibling)
  end
end

def t_roundtrip
  SOURCES.each do |set, dir|
    Dir[File.join(dir, "*")].sort.each do |f|
      roundtrip_file(f, set) if DATA_EXTS.include?(File.extname(f))
    end
  end
end
t_roundtrip

def t_unknown_class_roundtrip
  require "tmpdir"
  Dir.mktmpdir("unk") do |d|
    src = File.join(d, "Custom.rvdata2")
    build = <<RUBY
module RPG
  class CustomThing
    def initialize
      @title = "なまえ"
      @count = 3
    end
  end
end
File.binwrite(#{src.inspect}, Marshal.dump([RPG::CustomThing.new, nil]))
RUBY
    system(RbConfig.ruby, "-e", build)
    # dump straight into d so Custom.json becomes a SIBLING of Custom.rvdata2
    # (translate reads the sibling json)
    out, code = run_tool("--dump=#{src}", "--dest=#{d}")
    assert(code == 0, "unknown class dumps without crash")
    json = JSON.parse(File.read(File.join(d, "Custom.json")))
    assert_eq([[0, { "json_class" => "RPG::CustomThing" }], [1, nil]], json,
              "unknown class dumps as json_class marker only")

    out_dir = File.join(d, "out"); FileUtils.mkdir_p(out_dir)
    out, code = run_tool("--translate=#{src}", "--dest=#{out_dir}")
    assert(code == 0, "unknown class translates without crash")
    prod = File.binread(File.join(out_dir, "Custom.rvdata2"))
    assert(prod == Marshal.dump(Model.load(src)), "unknown class marshal bytes preserved")
  end
end
t_unknown_class_roundtrip
