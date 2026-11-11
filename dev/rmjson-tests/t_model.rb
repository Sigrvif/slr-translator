$LOAD_PATH.unshift(File.expand_path("../../www/php/plugins/rmvxace/bin", __dir__))
require "model"
require "tmpdir"

def t_model
  Dir.mktmpdir("model") do |d|
    # 1. unknown classes auto-stub and round-trip
    src = <<RUBY
module RPG
  class Weird
    def initialize
      @zz = "hello"
      @n = 42
    end
  end
  class Container
    def initialize
      @items = [RPG::Weird.new]
      @tone = Tone.new
      @rect = Rect.new
      @table = Table.new
    end
  end
end
class Table; def _dump(d = 0); "TABBYTES"; end; def self._load(s); Table.new; end; end
class Rect; def _dump(d = 0); "RECTBYTES"; end; def self._load(s); Rect.new; end; end
class Tone; def _dump(d = 0); "TONEBYTES"; end; def self._load(s); Tone.new; end; end
RUBY
    path = File.join(d, "x.rvdata2")
    system(RbConfig.ruby, "-e", src + "\nFile.binwrite(#{path.inspect}, Marshal.dump(RPG::Container.new))")
    assert(File.file?(path), "fixture file written")

    obj = Model.load(path)
    assert(obj.class.name == "RPG::Container", "unknown container class loaded: #{obj.class}")
    items = obj.instance_variable_get(:@items)
    assert(items[0].class.name == "RPG::Weird", "nested unknown class loaded")
    assert(items[0].instance_variable_get(:@zz) == "hello", "nested ivar preserved")

    # 2. userdef byte passthrough (Tone/Rect/Table are predefined by Model)
    tone = obj.instance_variable_get(:@tone)
    assert(tone.class.name == "Tone", "Tone is Model's passthrough class")
    assert(tone._dump == "TONEBYTES", "Tone bytes preserved")
    rect = obj.instance_variable_get(:@rect)
    assert(rect._dump == "RECTBYTES", "Rect bytes preserved")

    # 3. marshal round-trip through Model is byte-stable for regular objects
    again = Model.load(path)
    assert(Marshal.dump(again) == File.binread(path), "round-trip byte-identical (regular objects)")
  end
end
t_model
