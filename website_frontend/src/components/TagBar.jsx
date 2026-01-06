import React from "react";

export default function TagBar({ 
  possibleTags, 
  tags, 
  handleChange, 
  handleClick,
  handleRemoval,
  isActive = false,
}) {
  const searchTags = tags;
  const availableTags = possibleTags;

  const matchTag = (word, tag) => `${tag.field}: ${tag.value}`.toLowerCase().includes(word.toLowerCase());

  return (
    <div
      className={"rounded px-1 py-1 text-sm w-64 md:w-96 lg:w-[32rem]" + (isActive ? " border-3" : " border")}
      onClick={handleClick}
      // className="border rounded px-1 py-1 text-sm w-96 lg:w-[32rem]"
    >
      {searchTags.length < 1 && <div className="my-1 px-2 h-5 flex">
        {"Empty Group"}
        <span 
          className="relative w-5 h-5 rounded-full flex items-center justify-center 
            hover:bg-black/10 hover:cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            handleRemoval();
          }}
        >
          <span
            className="relative w-2.5 h-2.5 flex items-center justify-center before:content-['']
              before:absolute before:w-0.5 before:h-2.5 before:bg-[#888] before:rounded-full
              before:rotate-45 after:content-[''] after:absolute after:w-0.5 after:h-2.5 after:bg-[#888]
              after:rounded-full after:-rotate-45"
          ></span>
        </span></div>
      }
      {
        searchTags.map((t, i) => (
          <span
            className={`inline-flex items-center my-1 px-2 py-0.5 rounded-full text-xs font-medium mx-2 
              caret-transparent bg-yellow-100 text-yellow-800 || "bg-gray-200 text-gray-700"
            `}
            key={`tag-${i}`}
          >
            {`${t.field}: ${t.value}`}
            <span 
              className="relative w-5 h-5 rounded-full flex items-center justify-center 
                hover:bg-black/10 hover:cursor-pointer"
              onClick={() => {
                  handleChange(
                    searchTags.filter((st) => !matchTag(`${t.field}: ${t.value}`, st)), 
                    [...availableTags, t]
                  );
                }}
            >
              <span
                className="relative w-2.5 h-2.5 flex items-center justify-center before:content-['']
                  before:absolute before:w-0.5 before:h-2.5 before:bg-[#888] before:rounded-full
                  before:rotate-45 after:content-[''] after:absolute after:w-0.5 after:h-2.5 after:bg-[#888]
                  after:rounded-full after:-rotate-45"
              ></span>
            </span>
          </span>
        ))
      }
    </div>
  )
}