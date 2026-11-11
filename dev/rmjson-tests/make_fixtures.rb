#!/usr/bin/env ruby
# Generates synthetic RPG Maker XP/VX/VXAce data files for testing.
# Usage: ruby make_fixtures.rb <out_dir>
require "zlib"
require "fileutils"

OUT = ARGV[0] || File.join(__dir__, "golden-src")

class Rect;  def _dump(d = 0); [1.0, 2.0, 3.0, 4.0].pack("d4"); end; def self._load(s); Rect.new; end; end
class Tone;  def _dump(d = 0); [1.0, 2.0, 3.0, 4.0].pack("d4"); end; def self._load(s); Tone.new; end; end
class Color; def _dump(d = 0); [1.0, 2.0, 3.0, 4.0].pack("d4"); end; def self._load(s); Color.new; end; end
class Table; def _dump(d = 0); [2, 1, 2, 0, 0, 0].pack("l*");     end; def self._load(s); Table.new; end; end

XP_WORDS = %w[gold hp sp str dex agi int atk pdef mdef
              weapon armor1 armor2 armor3 armor4 attack skill guard item equip]
VX_TERMS = %w[level level_a hp hp_a mp mp_a atk def spi agi
              weapon armor1 armor2 armor3 armor4 weapon1 weapon2
              attack skill guard item equip status save game_end
              fight escape new_game continue shutdown to_title cancel gold]

module RPG
  class System
    class Words
      XP_WORDS.each { |w| attr_accessor w.to_sym }
      def initialize
        XP_WORDS.each { |w| instance_variable_set("@#{w}", w) }
      end
    end
    class Terms
      VX_TERMS.each { |w| attr_accessor w.to_sym }
      def initialize
        VX_TERMS.each { |w| instance_variable_set("@#{w}", w) }
      end
    end

    attr_accessor :game_title, :currency_unit, :elements, :skill_types,
                  :weapon_types, :armor_types, :switches, :variables, :words, :terms
    def initialize(engine)
      @game_title = "テストゲーム"; @currency_unit = "G"
      @elements = [nil, "物理", "炎"]; @skill_types = [nil, "魔法"]
      @weapon_types = [nil, "剣"]; @armor_types = [nil, "鎧"]
      @switches = [nil, "スイッチ"]; @variables = [nil, "変数"]
      @words = Words.new if engine == :xp
      @terms = Terms.new if engine == :vx
    end
  end

  class EventCommand
    attr_accessor :code, :indent, :parameters
    def initialize(code = 0, indent = 0, parameters = [])
      @code, @indent, @parameters = code, indent, parameters
    end
  end

  class Event
    class Page
      attr_accessor :list
      def initialize; @list = [EventCommand.new]; end
    end
    attr_accessor :name, :pages
    def initialize(name); @name = name; @pages = [Page.new]; end
  end

  class CommonEvent
    attr_accessor :name, :list
    def initialize(name, list); @name = name; @list = list; end
  end

  class Map
    attr_accessor :display_name, :note, :events
    def initialize; @display_name = ""; @note = ""; @events = {}; end
  end

  class MapInfo
    attr_accessor :name
    def initialize(name); @name = name; end
  end

  class Actor
    attr_accessor :id, :name, :nickname, :description, :note, :character_name
    def initialize(id, name)
      @id = id; @name = name; @nickname = ""; @description = ""; @note = ""
      @character_name = "Actor1"           # non-translatable filename ivar
    end
  end

  class State
    attr_accessor :name, :message1, :message2, :message3, :message4, :note
    def initialize(name)
      @name = name; @message1 = ""; @message2 = ""; @message3 = ""; @message4 = ""; @note = ""
    end
  end
end

def text_run(lines, head_code, cont_code)
  lines.each_with_index.map { |l, i| RPG::EventCommand.new(i.zero? ? head_code : cont_code, 0, [l]) }
end

def command_list(engine)
  list = []
  list.concat(text_run(["一行目", "二行目"], engine == :xp ? 101 : 401, 401))
  list << RPG::EventCommand.new(101, 0, ["", 1, 0, 2]) if engine != :xp  # text attributes (vx/ace only; in xp, 101 is a merge-map key and a multi-param 101 would be split)
  list << RPG::EventCommand.new(102, 0, [["はい", "いいえ"], 1]) # choices: mixed params
  list.concat(text_run(["# comment"], 108, 408))
  list.concat(text_run(["p 1", "p 2"], 355, 655))
  list << RPG::EventCommand.new(122, 0, [1, 0, 0, 4, "script_str"]) # scripted control variables
  list << RPG::EventCommand.new(122, 0, [2, 0, 1, 0, 5])           # ordinary control variables
  list << RPG::EventCommand.new(999, 0, ["?"])                     # unknown code
  list << RPG::EventCommand.new(320, 0, ["新しい名前"])             # change actor name
  list << RPG::EventCommand.new(0)                                  # terminator
end

def write(path, data)
  File.binwrite(path, Marshal.dump(data))
  puts "wrote #{path}"
end

def build(engine, dir)
  ext = { xp: ".rxdata", vx: ".rvdata", ace: ".rvdata2" }[engine]
  FileUtils.mkdir_p(dir)
  write(File.join(dir, "Actors#{ext}"),   [nil, RPG::Actor.new(1, "レリカ"), RPG::Actor.new(2, "ハルカ")])
  write(File.join(dir, "States#{ext}"),   [nil, RPG::State.new("毒")])
  ev = RPG::Event.new("EV001")
  ev.pages[0].list = command_list(engine)
  map = RPG::Map.new
  map.display_name = "最初の町"; map.note = "note text"; map.events[1] = ev
  write(File.join(dir, "Map001#{ext}"),   map)
  write(File.join(dir, "MapInfos#{ext}"), { 1 => RPG::MapInfo.new("最初の町"), 5 => RPG::MapInfo.new("城") })
  write(File.join(dir, "CommonEvents#{ext}"),
        [nil, RPG::CommonEvent.new("コモン", command_list(engine))])
  write(File.join(dir, "System#{ext}"),   RPG::System.new(engine))
  scripts = 3.times.map do |i|
    [100 + i, "Script#{i}", Zlib::Deflate.deflate("# script #{i}\nputs 'こんにちは'\n")]
  end
  write(File.join(dir, "Scripts#{ext}"),  scripts)
end

build(:xp,  File.join(OUT, "xp"))
build(:vx,  File.join(OUT, "vx"))
build(:ace, File.join(OUT, "ace"))
